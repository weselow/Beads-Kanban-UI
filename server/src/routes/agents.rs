//! Agent API route handlers.
//!
//! Provides endpoints for listing and updating `.claude/agents/*.md` files.
//! Each agent file uses YAML frontmatter with fields: name, description, model,
//! and tools.

use axum::{
    extract::{Path as AxumPath, Query},
    http::StatusCode,
    response::IntoResponse,
    Json,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use super::validate_path_security;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Represents the `tools` field in agent frontmatter.
///
/// Values are normalised while parsing so the API always answers with one of
/// two shapes: the string `"*"` (all tools) or an array of tool names.
/// A comma separated scalar such as `tools: Read, Grep, Glob` — the common
/// Claude Code spelling — becomes a list, never a raw string.
#[derive(Debug, Serialize, Clone)]
#[serde(untagged)]
pub enum AgentTools {
    All(String),
    List(Vec<String>),
}

/// Marker used in frontmatter and on the wire for "every tool".
const ALL_TOOLS_MARKER: &str = "*";

/// Trim tool names and drop the empty ones.
fn clean_tool_names<I>(items: I) -> Vec<String>
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    items
        .into_iter()
        .map(|name| name.as_ref().trim().to_string())
        .filter(|name| !name.is_empty())
        .collect()
}

/// Turn a scalar `tools:` value into the normalised form.
///
/// `"*"` keeps its "all tools" meaning; anything else is treated as a comma
/// separated list of tool names.
fn normalize_tools_scalar(raw: &str) -> AgentTools {
    let trimmed = raw.trim();
    if trimmed == ALL_TOOLS_MARKER {
        return AgentTools::All(ALL_TOOLS_MARKER.to_string());
    }
    AgentTools::List(clean_tool_names(trimmed.split(',')))
}

impl<'de> Deserialize<'de> for AgentTools {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        /// Raw shapes accepted from YAML frontmatter and from JSON.
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum RawTools {
            Scalar(String),
            List(Vec<String>),
        }

        Ok(match RawTools::deserialize(deserializer)? {
            RawTools::Scalar(value) => normalize_tools_scalar(&value),
            RawTools::List(items) => AgentTools::List(clean_tool_names(items)),
        })
    }
}

/// Information about a single agent parsed from its `.md` file.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AgentInfo {
    pub filename: String,
    pub name: String,
    /// Model name exactly as written in the file. Kept as a free string on
    /// purpose: `inherit`, `opusplan` and full model ids are all legitimate,
    /// and a missing field yields an empty string.
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub description: String,
    /// `None` when the file has no `tools:` field, which means "all tools".
    #[serde(default)]
    pub tools: Option<AgentTools>,
    /// The agent's nickname/persona, extracted from the markdown body.
    #[serde(default)]
    pub nickname: Option<String>,
}

/// YAML frontmatter structure as parsed from agent files.
#[derive(Debug, Serialize, Deserialize, Clone)]
struct AgentFrontmatter {
    pub name: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub tools: Option<AgentTools>,
}

/// Query parameters for the list agents endpoint.
#[derive(Debug, Deserialize)]
pub struct AgentParams {
    pub path: String,
}

/// Request body for the update agent endpoint.
#[derive(Debug, Deserialize)]
pub struct UpdateAgentBody {
    pub path: String,
    pub model: String,
    #[serde(default)]
    pub all_tools: bool,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build the path to the agents directory.
fn agents_dir(project_path: &Path) -> PathBuf {
    project_path.join(".claude").join("agents")
}

/// Fix bare `*` in YAML tools field so serde_yaml can parse it.
///
/// In agent files, `tools: *` (bare asterisk) is a YAML alias reference and
/// will cause a parse error. This regex replaces it with `tools: '*'` (quoted).
fn fix_bare_star(yaml_str: &str) -> String {
    let re = Regex::new(r"(?m)^(tools:\s*)\*\s*$").unwrap();
    re.replace_all(yaml_str, r#"$1"*""#).to_string()
}

/// Split a file's content into YAML frontmatter and markdown body.
///
/// Expects the format:
/// ```text
/// ---
/// key: value
/// ---
/// # Markdown body...
/// ```
///
/// Returns `(yaml_str, body_str)` or an error if delimiters are not found.
fn split_frontmatter(content: &str) -> Result<(String, String), String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return Err("File does not start with YAML frontmatter delimiter".to_string());
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    let closing_pos = after_first
        .find("\n---")
        .ok_or_else(|| "Could not find closing YAML frontmatter delimiter".to_string())?;

    let yaml_str = after_first[..closing_pos].trim().to_string();

    // Body starts after the closing ---
    let body_start = closing_pos + 4; // skip "\n---"
    let body = if body_start < after_first.len() {
        after_first[body_start..].to_string()
    } else {
        String::new()
    };

    Ok((yaml_str, body))
}

/// Extract a nickname/persona from the markdown body.
///
/// Looks for patterns like `# Nickname: "Luna"` or `**Name:** Luna` in the body.
fn extract_nickname(body: &str) -> Option<String> {
    // Pattern: **Name:** Something
    let name_re = Regex::new(r#"\*\*Name:\*\*\s*(.+)"#).ok()?;
    if let Some(caps) = name_re.captures(body) {
        let name = caps.get(1)?.as_str().trim().to_string();
        if !name.is_empty() {
            return Some(name);
        }
    }

    // Pattern: # Something: "Nickname"
    let header_re = Regex::new(r#"#\s+\w+.*?:\s*"([^"]+)""#).ok()?;
    if let Some(caps) = header_re.captures(body) {
        let name = caps.get(1)?.as_str().trim().to_string();
        if !name.is_empty() {
            return Some(name);
        }
    }

    None
}

/// Parse a single agent file into an `AgentInfo`.
fn parse_agent_file(filepath: &Path) -> Result<AgentInfo, String> {
    let filename = filepath
        .file_name()
        .and_then(|f| f.to_str())
        .ok_or_else(|| "Invalid filename".to_string())?
        .to_string();

    let content = std::fs::read_to_string(filepath)
        .map_err(|e| format!("Failed to read {}: {}", filename, e))?;

    let (yaml_str, body) = split_frontmatter(&content)?;
    let yaml_fixed = fix_bare_star(&yaml_str);

    let frontmatter: AgentFrontmatter = serde_yaml::from_str(&yaml_fixed)
        .map_err(|e| format!("Failed to parse YAML in {}: {}", filename, e))?;

    let nickname = extract_nickname(&body);

    Ok(AgentInfo {
        filename,
        name: frontmatter.name,
        model: frontmatter.model,
        description: frontmatter.description,
        tools: frontmatter.tools,
        nickname,
    })
}

/// Validate that a filename is safe (no path traversal, valid characters).
fn validate_agent_filename(filename: &str) -> Result<(), String> {
    // Must end with .md
    if !filename.ends_with(".md") {
        return Err("Filename must end with .md".to_string());
    }

    // No path traversal
    if filename.contains("..") || filename.contains('/') || filename.contains('\\') {
        return Err("Invalid filename: path traversal not allowed".to_string());
    }

    // Only allow alphanumeric, hyphens, underscores, and .md extension
    let stem = filename.trim_end_matches(".md");
    if stem.is_empty() {
        return Err("Filename must not be empty".to_string());
    }

    let valid_re = Regex::new(r"^[a-zA-Z0-9_-]+$").unwrap();
    if !valid_re.is_match(stem) {
        return Err(
            "Filename must contain only alphanumeric characters, hyphens, and underscores"
                .to_string(),
        );
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/agents?path={project_path}
///
/// Lists all agent files from `.claude/agents/` within the given project path.
/// Parses YAML frontmatter and extracts agent metadata including nickname.
pub async fn list_agents(Query(params): Query<AgentParams>) -> impl IntoResponse {
    let project_path = PathBuf::from(&params.path);

    // Security: Validate path is within allowed directories
    if let Err(e) = validate_path_security(&project_path) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": e })),
        );
    }

    let dir = agents_dir(&project_path);

    if !dir.exists() {
        return (StatusCode::OK, Json(serde_json::json!([])));
    }

    let entries = match std::fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to read agents directory: {}", e) })),
            );
        }
    };

    let mut agents: Vec<AgentInfo> = Vec::new();

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };

        let path = entry.path();

        // Only process .md files
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }

        match parse_agent_file(&path) {
            Ok(agent) => agents.push(agent),
            Err(e) => {
                tracing::debug!("Skipping agent file {:?}: {}", path, e);
            }
        }
    }

    // Sort by name for consistent ordering
    agents.sort_by(|a, b| a.name.cmp(&b.name));

    (StatusCode::OK, Json(serde_json::json!(agents)))
}

/// PUT /api/agents/:filename
///
/// Updates the model and optionally sets tools to `*` in an agent file.
/// Preserves the markdown body and other frontmatter fields.
pub async fn update_agent(
    AxumPath(filename): AxumPath<String>,
    Json(payload): Json<UpdateAgentBody>,
) -> impl IntoResponse {
    // Validate filename
    if let Err(e) = validate_agent_filename(&filename) {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e })),
        );
    }

    let project_path = PathBuf::from(&payload.path);

    // Security: Validate path is within allowed directories
    if let Err(e) = validate_path_security(&project_path) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({ "error": e })),
        );
    }

    let file_path = agents_dir(&project_path).join(&filename);

    if !file_path.exists() {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": format!("Agent file '{}' not found", filename) })),
        );
    }

    let content = match std::fs::read_to_string(&file_path) {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to read file: {}", e) })),
            );
        }
    };

    let (yaml_str, body) = match split_frontmatter(&content) {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e })),
            );
        }
    };

    let yaml_fixed = fix_bare_star(&yaml_str);

    // Parse as serde_yaml::Value so we can modify individual fields
    let mut yaml_value: serde_yaml::Value = match serde_yaml::from_str(&yaml_fixed) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to parse YAML: {}", e) })),
            );
        }
    };

    // Update model field
    if let serde_yaml::Value::Mapping(ref mut map) = yaml_value {
        map.insert(
            serde_yaml::Value::String("model".to_string()),
            serde_yaml::Value::String(payload.model.clone()),
        );

        // Update tools field if all_tools is true
        if payload.all_tools {
            map.insert(
                serde_yaml::Value::String("tools".to_string()),
                serde_yaml::Value::String(ALL_TOOLS_MARKER.to_string()),
            );
        }
    }

    // Serialize YAML back
    let new_yaml = match serde_yaml::to_string(&yaml_value) {
        Ok(y) => y,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": format!("Failed to serialize YAML: {}", e) })),
            );
        }
    };

    // serde_yaml::to_string adds a trailing newline and no leading ---, so we
    // need to reassemble with proper delimiters.
    // Also: serde_yaml quotes '*' as "'*'" which is fine for YAML but we want
    // the cleaner format `tools: '*'`.
    let new_yaml_trimmed = new_yaml.trim();

    // Reassemble the file: ---\n{yaml}\n---\n{body}
    let new_content = format!("---\n{}\n---{}", new_yaml_trimmed, body);

    if let Err(e) = std::fs::write(&file_path, &new_content) {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Failed to write file: {}", e) })),
        );
    }

    // Re-parse the updated file and return agent info
    match parse_agent_file(&file_path) {
        Ok(agent) => (StatusCode::OK, Json(serde_json::json!(agent))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": format!("Failed to re-read updated file: {}", e) })),
        ),
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_fix_bare_star() {
        let input = "name: test\ntools: *\nmodel: opus";
        let output = fix_bare_star(input);
        assert!(output.contains(r#"tools: "*""#));
        assert!(output.contains("name: test"));
        assert!(output.contains("model: opus"));
    }

    #[test]
    fn test_fix_bare_star_already_quoted() {
        let input = "name: test\ntools: '*'\nmodel: opus";
        let output = fix_bare_star(input);
        // Should not double-quote
        assert_eq!(output, input);
    }

    #[test]
    fn test_fix_bare_star_list() {
        let input = "name: test\ntools:\n  - Read\n  - Glob\nmodel: opus";
        let output = fix_bare_star(input);
        // Should not change tool lists
        assert_eq!(output, input);
    }

    #[test]
    fn test_split_frontmatter() {
        let content = "---\nname: test\nmodel: opus\n---\n# Hello\n\nBody here.";
        let (yaml, body) = split_frontmatter(content).unwrap();
        assert_eq!(yaml, "name: test\nmodel: opus");
        assert!(body.contains("# Hello"));
        assert!(body.contains("Body here."));
    }

    #[test]
    fn test_split_frontmatter_no_delimiter() {
        let content = "# No frontmatter here";
        let result = split_frontmatter(content);
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_nickname_bold_name() {
        let body = "# Scout: \"Ivy\"\n\n- **Name:** Ivy\n- **Role:** Scout";
        let nickname = extract_nickname(body);
        assert_eq!(nickname, Some("Ivy".to_string()));
    }

    #[test]
    fn test_extract_nickname_header() {
        let body = "# Implementation Supervisor: \"Luna\"\n\nSome content";
        let nickname = extract_nickname(body);
        // First tries **Name:**, then header pattern
        assert_eq!(nickname, Some("Luna".to_string()));
    }

    #[test]
    fn test_extract_nickname_none() {
        let body = "# Just a heading\n\nNo nickname pattern here.";
        let nickname = extract_nickname(body);
        assert!(nickname.is_none());
    }

    #[test]
    fn test_validate_agent_filename_valid() {
        assert!(validate_agent_filename("scout.md").is_ok());
        assert!(validate_agent_filename("nextjs-supervisor.md").is_ok());
        assert!(validate_agent_filename("my_agent.md").is_ok());
        assert!(validate_agent_filename("Agent123.md").is_ok());
    }

    #[test]
    fn test_validate_agent_filename_invalid() {
        assert!(validate_agent_filename("scout.txt").is_err());
        assert!(validate_agent_filename("../etc/passwd.md").is_err());
        assert!(validate_agent_filename("path/to/file.md").is_err());
        assert!(validate_agent_filename(".md").is_err());
        assert!(validate_agent_filename("bad file.md").is_err());
        assert!(validate_agent_filename("bad@file.md").is_err());
    }

    #[test]
    fn test_parse_agent_file_with_tools_list() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("scout.md");
        fs::write(
            &file_path,
            "---\nname: scout\ndescription: Codebase exploration\nmodel: haiku\ntools:\n  - Read\n  - Glob\n  - Grep\n---\n\n# Scout: \"Ivy\"\n\n- **Name:** Ivy\n- **Role:** Scout\n",
        )
        .unwrap();

        let agent = parse_agent_file(&file_path).unwrap();
        assert_eq!(agent.filename, "scout.md");
        assert_eq!(agent.name, "scout");
        assert_eq!(agent.model, "haiku");
        assert_eq!(agent.description, "Codebase exploration");
        assert_eq!(agent.nickname, Some("Ivy".to_string()));

        match agent.tools {
            Some(AgentTools::List(tools)) => {
                assert_eq!(tools.len(), 3);
                assert!(tools.contains(&"Read".to_string()));
                assert!(tools.contains(&"Glob".to_string()));
                assert!(tools.contains(&"Grep".to_string()));
            }
            _ => panic!("Expected tool list"),
        }
    }

    #[test]
    fn test_parse_agent_file_with_all_tools_quoted() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("supervisor.md");
        fs::write(
            &file_path,
            "---\nname: supervisor\ndescription: Full access\nmodel: opus\ntools: '*'\n---\n\n# Implementation Supervisor: \"Luna\"\n\n- **Name:** Luna\n",
        )
        .unwrap();

        let agent = parse_agent_file(&file_path).unwrap();
        assert_eq!(agent.name, "supervisor");
        assert_eq!(agent.model, "opus");
        assert_eq!(agent.nickname, Some("Luna".to_string()));

        match agent.tools {
            Some(AgentTools::All(s)) => assert_eq!(s, "*"),
            _ => panic!("Expected AgentTools::All"),
        }
    }

    #[test]
    fn test_parse_agent_file_with_bare_star() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("agent.md");
        fs::write(
            &file_path,
            "---\nname: agent\ndescription: Test\nmodel: sonnet\ntools: *\n---\n\n# Body\n",
        )
        .unwrap();

        let agent = parse_agent_file(&file_path).unwrap();
        assert_eq!(agent.name, "agent");
        match agent.tools {
            Some(AgentTools::All(s)) => assert_eq!(s, "*"),
            _ => panic!("Expected AgentTools::All for bare star"),
        }
    }

    #[test]
    fn test_parse_agent_file_no_tools() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("minimal.md");
        fs::write(
            &file_path,
            "---\nname: minimal\ndescription: Minimal agent\nmodel: haiku\n---\n\n# Body\n",
        )
        .unwrap();

        let agent = parse_agent_file(&file_path).unwrap();
        assert_eq!(agent.name, "minimal");
        assert!(agent.tools.is_none());
    }

    #[test]
    fn test_agents_dir() {
        let project = PathBuf::from("/home/user/project");
        let dir = agents_dir(&project);
        assert_eq!(dir, PathBuf::from("/home/user/project/.claude/agents"));
    }

    #[test]
    fn test_agent_tools_serde_list() {
        let json = r#"["Read","Glob","Grep"]"#;
        let tools: AgentTools = serde_json::from_str(json).unwrap();
        match tools {
            AgentTools::List(v) => assert_eq!(v.len(), 3),
            _ => panic!("Expected List"),
        }
    }

    #[test]
    fn test_agent_tools_serde_all() {
        let json = r#""*""#;
        let tools: AgentTools = serde_json::from_str(json).unwrap();
        match tools {
            AgentTools::All(s) => assert_eq!(s, "*"),
            _ => panic!("Expected All"),
        }
    }

    // -- Normalisation of the `tools:` field ------------------------------

    #[test]
    fn test_parse_agent_file_with_comma_separated_tools() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("explorer.md");
        fs::write(
            &file_path,
            "---
name: explorer
description: Reads code
model: sonnet
tools: Read, Grep, Glob, Bash
---

# Body
",
        )
        .unwrap();

        let agent = parse_agent_file(&file_path).unwrap();
        match agent.tools {
            Some(AgentTools::List(tools)) => {
                assert_eq!(
                    tools,
                    vec![
                        "Read".to_string(),
                        "Grep".to_string(),
                        "Glob".to_string(),
                        "Bash".to_string()
                    ]
                );
            }
            other => panic!("Expected a 4-item list, got {:?}", other),
        }
    }

    #[test]
    fn test_agent_tools_deserialize_comma_string() {
        let tools: AgentTools = serde_json::from_str(r#""Read, Grep, Glob""#).unwrap();
        match tools {
            AgentTools::List(v) => assert_eq!(v, vec!["Read", "Grep", "Glob"]),
            other => panic!("Expected List, got {:?}", other),
        }
    }

    #[test]
    fn test_agent_tools_deserialize_single_scalar_tool() {
        let tools: AgentTools = serde_json::from_str(r#""Read""#).unwrap();
        match tools {
            AgentTools::List(v) => assert_eq!(v, vec!["Read"]),
            other => panic!("Expected a one-item List, got {:?}", other),
        }
    }

    #[test]
    fn test_agent_tools_deserialize_trims_and_drops_empty() {
        let tools: AgentTools = serde_json::from_str(r#""  Read ,, Grep ,  ""#).unwrap();
        match tools {
            AgentTools::List(v) => assert_eq!(v, vec!["Read", "Grep"]),
            other => panic!("Expected List, got {:?}", other),
        }
    }

    #[test]
    fn test_agent_tools_deserialize_list_is_trimmed() {
        let tools: AgentTools = serde_json::from_str(r#"[" Read ", "", "Glob"]"#).unwrap();
        match tools {
            AgentTools::List(v) => assert_eq!(v, vec!["Read", "Glob"]),
            other => panic!("Expected List, got {:?}", other),
        }
    }

    #[test]
    fn test_agent_tools_serialize_shapes() {
        assert_eq!(
            serde_json::to_string(&AgentTools::All("*".to_string())).unwrap(),
            r#""*""#
        );
        assert_eq!(
            serde_json::to_string(&AgentTools::List(vec!["Read".to_string()])).unwrap(),
            r#"["Read"]"#
        );
    }

    #[test]
    fn test_parse_agent_file_star_stays_all() {
        // Both the quoted and the bare form must keep meaning "all tools".
        for frontmatter in ["tools: '*'", "tools: *"] {
            let dir = tempfile::tempdir().unwrap();
            let file_path = dir.path().join("all.md");
            fs::write(
                &file_path,
                format!("---
name: all
model: opus
{}
---

# Body
", frontmatter),
            )
            .unwrap();

            let agent = parse_agent_file(&file_path).unwrap();
            match agent.tools {
                Some(AgentTools::All(s)) => assert_eq!(s, "*"),
                other => panic!("Expected All for {:?}, got {:?}", frontmatter, other),
            }
        }
    }

    // -- Unknown model values ---------------------------------------------

    #[test]
    fn test_parse_agent_file_unknown_model() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("inherit.md");
        fs::write(
            &file_path,
            "---
name: inherit-agent
description: Uses the parent model
model: inherit
---

# Body
",
        )
        .unwrap();

        let agent = parse_agent_file(&file_path).unwrap();
        assert_eq!(agent.model, "inherit");
        assert!(agent.tools.is_none());
    }

    #[test]
    fn test_agent_info_round_trip_keeps_unknown_model_and_null_tools() {
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("opusplan.md");
        fs::write(
            &file_path,
            "---
name: planner
model: opusplan
---

# Body
",
        )
        .unwrap();

        let agent = parse_agent_file(&file_path).unwrap();
        let json = serde_json::to_string(&agent).unwrap();
        assert!(json.contains(r#""model":"opusplan""#), "json was {}", json);
        assert!(json.contains(r#""tools":null"#), "json was {}", json);

        let back: AgentInfo = serde_json::from_str(&json).unwrap();
        assert_eq!(back.model, "opusplan");
        assert!(back.tools.is_none());
    }
}
