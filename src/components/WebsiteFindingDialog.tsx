import { useEffect, useRef } from "react";
import ShareFinding from "./ShareFinding";
import "./WebsiteFindingDialog.css";
export type WebsiteFindingPreview = {
  domain: string;
  verdict: string;
  score: number;
  reasons: string[];
  recordedAt: string;
};
export default function WebsiteFindingDialog({
  finding,
  onClose,
}: {
  finding: WebsiteFindingPreview;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  return (
    <dialog
      className="website-finding-dialog"
      ref={dialog}
      onClose={onClose}
      aria-labelledby="website-finding-title"
    >
      <header>
        <div>
          <h2 id="website-finding-title">Share a website finding</h2>
          <p>{finding.domain}</p>
        </div>
        <button
          type="button"
          onClick={() => dialog.current?.close()}
          aria-label="Close website finding"
        >
          Close
        </button>
      </header>
      <p>
        Choose an organization and review what will be shared. Your website
        history stays private unless you submit a finding.
      </p>
      <ShareFinding
        initialOpen
        finding={{
          title: `Website finding: ${finding.domain}`,
          kind: "link",
          domain: finding.domain,
          details: `Website: ${finding.domain}\nRecorded check: ${finding.recordedAt}\nVerdict: ${finding.verdict} · Risk ${finding.score}/100\n${finding.reasons.join("\n")}`,
          scanner: {
            source: "website_tracker",
            verdict: finding.verdict,
            score: finding.score,
            reasons: finding.reasons,
          },
        }}
      />
    </dialog>
  );
}
