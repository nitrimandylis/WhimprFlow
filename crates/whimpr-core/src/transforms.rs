//! Transforms: spoken commands that reshape a dictation instead of merely
//! cleaning it up — "make this an email", "summarise this", "turn this into a
//! to-do list".
//!
//! A transform is detected from a trigger phrase at the START of the utterance.
//! Leading-only matching is deliberate: a mid-sentence match would fire on people
//! *talking about* email rather than asking for one.
//!
//! Unlike cleanup, a transform is expected to rewrite heavily, so the caller runs
//! it WITHOUT the deterministic gates — those exist to catch a cleanup model
//! going rogue, and every one of them would reject a legitimate transform.

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transform {
    /// Stable id, used as the key when editing.
    pub id: String,
    pub name: String,
    /// Spoken phrases that select this transform, lower-case.
    pub triggers: Vec<String>,
    /// The instruction handed to the model.
    pub prompt: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformStore {
    #[serde(default)]
    pub items: Vec<Transform>,
}

impl Default for TransformStore {
    fn default() -> Self {
        Self {
            items: default_transforms(),
        }
    }
}

pub fn default_transforms() -> Vec<Transform> {
    vec![
        Transform {
            id: "email".into(),
            name: "Email".into(),
            triggers: vec![
                "make this an email".into(),
                "turn this into an email".into(),
                "write this as an email".into(),
            ],
            prompt: "Rewrite the dictation as a clear, courteous email body. Keep every fact, \
                     name, number and date exactly as spoken. Do not invent a greeting or \
                     sign-off unless the speaker said one. Do not add a subject line."
                .into(),
            enabled: true,
        },
        Transform {
            id: "summary".into(),
            name: "Summary".into(),
            triggers: vec![
                "summarise this".into(),
                "summarize this".into(),
                "make this a summary".into(),
            ],
            prompt: "Condense the dictation into a short summary of its key points. Preserve \
                     every fact, name, number and date. Add nothing that was not said."
                .into(),
            enabled: true,
        },
        Transform {
            id: "todo".into(),
            name: "To-do list".into(),
            triggers: vec![
                "make this a to do list".into(),
                "make this a todo list".into(),
                "turn this into tasks".into(),
            ],
            prompt: "Rewrite the dictation as a to-do list, one task per line, each starting \
                     with \"- \". Keep the speaker's wording and every detail. Invent no tasks."
                .into(),
            enabled: true,
        },
        Transform {
            id: "bullets".into(),
            name: "Bullet points".into(),
            triggers: vec!["make this bullet points".into(), "turn this into bullets".into()],
            prompt: "Rewrite the dictation as concise bullet points, one per line, each \
                     starting with \"- \". Preserve all facts and the speaker's meaning."
                .into(),
            enabled: true,
        },
        Transform {
            id: "professional".into(),
            name: "Professional tone".into(),
            triggers: vec![
                "make this professional".into(),
                "make this more formal".into(),
            ],
            prompt: "Rewrite the dictation in a professional, neutral register. Preserve every \
                     fact, name, number and date, and the speaker's intent. Do not lengthen it."
                .into(),
            enabled: true,
        },
    ]
}

impl TransformStore {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str::<TransformStore>(&s).ok())
            .filter(|s| !s.items.is_empty())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) {
        if let Some(t) = self.items.iter_mut().find(|t| t.id == id) {
            t.enabled = enabled;
        }
    }

    /// If `text` opens with a trigger phrase, return that transform plus the rest
    /// of the utterance with the trigger removed.
    ///
    /// Longest trigger first, so "make this a to do list" is not shadowed by a
    /// shorter trigger that happens to be a prefix of it.
    pub fn detect<'a>(&'a self, text: &str) -> Option<(&'a Transform, String)> {
        let lc = text.trim_start().to_lowercase();

        let mut candidates: Vec<(&Transform, &String)> = self
            .items
            .iter()
            .filter(|t| t.enabled)
            .flat_map(|t| t.triggers.iter().map(move |tr| (t, tr)))
            .collect();
        candidates.sort_by_key(|(_, tr)| std::cmp::Reverse(tr.chars().count()));

        for (t, trigger) in candidates {
            let trig = trigger.trim().to_lowercase();
            if trig.is_empty() || !lc.starts_with(&trig) {
                continue;
            }
            // The character right after the trigger must be a separator, so
            // "summarise this" doesn't fire on "summarise thistle".
            let rest_lc = &lc[trig.len()..];
            match rest_lc.chars().next() {
                Some(c) if c.is_alphanumeric() => continue,
                _ => {}
            }
            let trimmed = text.trim_start();
            let body = trimmed[trig.len()..]
                .trim_start_matches([':', ',', '.', '—', '-', ' ', '\n'])
                .trim()
                .to_string();
            if body.is_empty() {
                continue;
            }
            return Some((t, body));
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_an_email_transform_and_strips_the_trigger() {
        let s = TransformStore::default();
        let (t, body) = s.detect("Make this an email: tell Sam we ship Friday").unwrap();
        assert_eq!(t.id, "email");
        assert_eq!(body, "tell Sam we ship Friday");
    }

    #[test]
    fn ignores_a_trigger_that_is_not_at_the_start() {
        let s = TransformStore::default();
        assert!(s.detect("I will make this an email later").is_none());
    }

    #[test]
    fn requires_a_word_boundary_after_the_trigger() {
        let s = TransformStore::default();
        assert!(s.detect("summarise thistle farming").is_none());
    }

    #[test]
    fn returns_none_when_there_is_no_body() {
        let s = TransformStore::default();
        assert!(s.detect("make this an email").is_none());
    }

    #[test]
    fn skips_disabled_transforms() {
        let mut s = TransformStore::default();
        s.set_enabled("email", false);
        assert!(s.detect("make this an email: hello there").is_none());
    }

    #[test]
    fn prefers_the_longest_matching_trigger() {
        let s = TransformStore::default();
        let (t, _) = s.detect("make this a to do list: buy milk, call Sam").unwrap();
        assert_eq!(t.id, "todo");
    }
}
