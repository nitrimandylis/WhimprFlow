import { useEffect, useState } from "react";
import { Button, Group, GroupTitle, Note, PageHeader, Row } from "./ui";
import { getBuildInfo, exportHistory, copyToClipboard, type BuildInfo } from "./api";
import { useToast } from "./Toast";
import { useT } from "../i18n";

const TIP_KEYS: { title: string; body: string }[] = [
  { title: "help.tip.holdToDictate.title", body: "help.tip.holdToDictate.body" },
  { title: "help.tip.textLands.title", body: "help.tip.textLands.body" },
  { title: "help.tip.handsFree.title", body: "help.tip.handsFree.body" },
  { title: "help.tip.teachWords.title", body: "help.tip.teachWords.body" },
];

export function Help() {
  const t = useT();
  const [build, setBuild] = useState<BuildInfo | null>(null);
  const toast = useToast();

  useEffect(() => {
    getBuildInfo().then(setBuild);
  }, []);

  const doExport = async (format: "json" | "txt") => {
    try {
      const data = await exportHistory(format);
      await copyToClipboard(data);
      toast.success(t("help.toast.copiedAs", { format: format.toUpperCase() }));
    } catch {
      toast.error(t("help.toast.exportFailed"));
    }
  };

  return (
    <>
      <PageHeader title={t("sidebar.nav.help")} />
      <div className="pane-scroll">
        <div className="form">
          <GroupTitle>{t("help.group.using")}</GroupTitle>
          <Group>
            {TIP_KEYS.map((tip) => (
              <Row key={tip.title} label={t(tip.title)} hint={t(tip.body)} />
            ))}
          </Group>

          <GroupTitle>{t("help.group.export")}</GroupTitle>
          <Group>
            <Row label={t("help.row.copyHistory.label")} hint={t("help.row.copyHistory.hint")}>
              <Button onClick={() => void doExport("txt")}>{t("help.export.asText")}</Button>
              <Button onClick={() => void doExport("json")}>{t("help.export.asJson")}</Button>
            </Row>
          </Group>

          <GroupTitle>{t("help.group.support")}</GroupTitle>
          <Group>
            <Row label={t("help.row.troubleshooting.label")}>
              <a className="btn" href="https://github.com/nitrimandylis/WhimprFlow/blob/nick/polished/docs/HELP.md" target="_blank" rel="noreferrer">
                {t("help.link.openGithub")}
              </a>
            </Row>
            <Row label={t("help.row.reportProblem.label")}>
              <a className="btn" href="https://github.com/nitrimandylis/WhimprFlow/issues" target="_blank" rel="noreferrer">
                {t("help.link.githubIssues")}
              </a>
            </Row>
          </Group>
          {build && <Note>WhimprFlow {build.version} ({build.git_hash})</Note>}
        </div>
      </div>
    </>
  );
}
