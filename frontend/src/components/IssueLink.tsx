import type { Issue } from "../types";

export function IssueLink({ issue }: { issue: Issue }) {
  return (
    <a className="issue-key" href={issue.url} target="_blank" rel="noreferrer" title={`Open ${issue.key} in Jira`}>
      {issue.key}
    </a>
  );
}
