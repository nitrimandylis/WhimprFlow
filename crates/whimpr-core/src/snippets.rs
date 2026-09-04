//! Voice-triggered text expansion.
//!
//! A snippet maps a short spoken trigger ("my address") to a longer expansion.
//! Expansion runs on the CLEANED transcript, immediately before insertion — after
//! the cleanup gates, so a snippet can legitimately balloon the text without the
//! over-deletion / novelty gates rejecting the cleanup that produced it.
//!
//! Matching is case-insensitive and whole-phrase: a trigger of "sig" must not
//! fire inside "design".

use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snippet {
    /// What the user says.
    pub trigger: String,
    /// What gets typed instead.
    pub expansion: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SnippetStore {
    #[serde(default)]
    pub items: Vec<Snippet>,
}

impl SnippetStore {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_string_pretty(self).unwrap_or_default())
    }

    /// Add or replace by trigger (case-insensitive).
    pub fn add(&mut self, trigger: &str, expansion: &str) {
        let trigger = trigger.trim();
        if trigger.is_empty() {
            return;
        }
        let lc = trigger.to_lowercase();
        self.items.retain(|s| s.trigger.to_lowercase() != lc);
        self.items.push(Snippet {
            trigger: trigger.to_string(),
            expansion: expansion.to_string(),
        });
    }

    pub fn remove(&mut self, trigger: &str) {
        let lc = trigger.trim().to_lowercase();
        self.items.retain(|s| s.trigger.to_lowercase() != lc);
    }

    /// Apply every snippet to `text`.
    ///
    /// Longest triggers go first so that a longer phrase isn't pre-empted by a
    /// shorter one nested inside it ("my work address" vs "my address").
    pub fn expand(&self, text: &str) -> String {
        if self.items.is_empty() {
            return text.to_string();
        }
        let mut ordered: Vec<&Snippet> = self
            .items
            .iter()
            .filter(|s| !s.trigger.trim().is_empty())
            .collect();
        ordered.sort_by_key(|s| std::cmp::Reverse(s.trigger.trim().chars().count()));

        let mut out = text.to_string();
        for s in ordered {
            out = replace_phrase_ci(&out, s.trigger.trim(), &s.expansion);
        }
        out
    }
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// Case-insensitive, whole-phrase replace.
fn replace_phrase_ci(haystack: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() || haystack.is_empty() {
        return haystack.to_string();
    }
    let hay_lc = haystack.to_lowercase();
    let need_lc = needle.to_lowercase();

    // Lowercasing can change byte length in a few scripts, which would make byte
    // offsets from the lowercased copy meaningless against the original. Rare, so
    // just fall back to an exact-case replace rather than mis-slicing.
    if hay_lc.len() != haystack.len() {
        return haystack.replace(needle, replacement);
    }

    let mut out = String::with_capacity(haystack.len());
    let mut i = 0usize;
    while let Some(pos) = hay_lc[i..].find(&need_lc) {
        let start = i + pos;
        let end = start + need_lc.len();

        if !haystack.is_char_boundary(start) || !haystack.is_char_boundary(end) {
            // Can't trust these offsets; copy one byte and keep scanning.
            out.push_str(&haystack[i..start + 1]);
            i = start + 1;
            continue;
        }

        let before_ok = start == 0
            || !haystack[..start]
                .chars()
                .next_back()
                .map(is_word_char)
                .unwrap_or(false);
        let after_ok = end >= haystack.len()
            || !haystack[end..].chars().next().map(is_word_char).unwrap_or(false);

        out.push_str(&haystack[i..start]);
        if before_ok && after_ok {
            out.push_str(replacement);
        } else {
            out.push_str(&haystack[start..end]);
        }
        i = end;
    }
    out.push_str(&haystack[i..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store(pairs: &[(&str, &str)]) -> SnippetStore {
        let mut s = SnippetStore::default();
        for (t, e) in pairs {
            s.add(t, e);
        }
        s
    }

    #[test]
    fn expands_a_simple_trigger() {
        let s = store(&[("my address", "12 Rue Example, Paris")]);
        assert_eq!(
            s.expand("Send it to my address please."),
            "Send it to 12 Rue Example, Paris please."
        );
    }

    #[test]
    fn is_case_insensitive() {
        let s = store(&[("my address", "X")]);
        assert_eq!(s.expand("My Address works"), "X works");
    }

    #[test]
    fn respects_word_boundaries() {
        // "sig" must not fire inside "design".
        let s = store(&[("sig", "Best, Vraj")]);
        assert_eq!(s.expand("the design is done"), "the design is done");
        assert_eq!(s.expand("add sig here"), "add Best, Vraj here");
    }

    #[test]
    fn longest_trigger_wins() {
        let s = store(&[("my address", "SHORT"), ("my work address", "LONG")]);
        assert_eq!(s.expand("use my work address"), "use LONG");
    }

    #[test]
    fn replaces_every_occurrence() {
        let s = store(&[("ok", "okay")]);
        assert_eq!(s.expand("ok and ok"), "okay and okay");
    }

    #[test]
    fn add_replaces_existing_trigger() {
        let mut s = store(&[("a", "one")]);
        s.add("A", "two");
        assert_eq!(s.items.len(), 1);
        assert_eq!(s.expand("a"), "two");
    }

    #[test]
    fn empty_store_is_a_passthrough() {
        assert_eq!(SnippetStore::default().expand("unchanged"), "unchanged");
    }
}
