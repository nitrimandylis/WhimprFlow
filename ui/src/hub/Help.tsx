import { useEffect, useState } from "react";
import { Button, Group, GroupTitle, Note, PageHeader, Row } from "./ui";
import { getBuildInfo, exportHistory, copyToClipboard, type BuildInfo } from "./api";
import { useToast } from "./Toast";

const TIPS: { title: string; body: string }[] = [
  {
    title: "Hold to dictate",
    body: "Press and hold your dictation key, speak, release. Transcription runs on this Mac unless you pick a cloud engine.",
  },
  {
    title: "Text lands at the cursor",
    body: "Whatever app has focus receives the cleaned text. Cleanup strength is under Settings.",
  },
  {
    title: "Hands-free",
    body: "Double-tap the dictation key, or press the hands-free shortcut, to talk without holding anything. Press again to stop.",
  },
  {
    title: "Teach it words",
    body: "Names and jargon go in Dictionary. Correcting a single word right after a paste teaches it automatically.",
  },
];

export function Help() {
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const toast = useToast();

  useEffect(() => {
    getBuildInfo().then(setBuild);
  }, []);

  const doExport = async (format: "json" | "txt") => {
    try {
      const data = await exportHistory(format);
      await copyToClipboard(data);
      toast.success(`Copied history as ${format.toUpperCase()}`);
    } catch {
      toast.error("Export failed");
    }
  };

  return (
    <>
      <PageHeader title="Help" />
      <div className="pane-scroll">
        <div className="form">
          <GroupTitle>Using WhimprFlow</GroupTitle>
          <Group>
            {TIPS.map((t) => (
              <Row key={t.title} label={t.title} hint={t.body} />
            ))}
          </Group>

          <GroupTitle>Export</GroupTitle>
          <Group>
            <Row label="Copy dictation history" hint="Everything in History, to the clipboard.">
              <Button onClick={() => void doExport("txt")}>As text</Button>
              <Button onClick={() => void doExport("json")}>As JSON</Button>
            </Row>
          </Group>

          <GroupTitle>Support</GroupTitle>
          <Group>
            <Row label="Troubleshooting guide">
              <a className="btn" href="https://github.com/nitrimandylis/WhimprFlow/blob/nick/polished/docs/HELP.md" target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            </Row>
            <Row label="Report a problem">
              <a className="btn" href="https://github.com/nitrimandylis/WhimprFlow/issues" target="_blank" rel="noreferrer">
                GitHub issues
              </a>
            </Row>
          </Group>
          {build && <Note>WhimprFlow {build.version} ({build.git_hash})</Note>}
        </div>
      </div>
    </>
  );
}
