import { supabase } from "./supabase";
import { collectOrganizationPages } from "./organizationData";

export type NoticeOrganization = { id: string; name: string };
export type TeamNotice = {
  id: string;
  organization_id: string;
  article_title: string;
  article_url: string;
  article_source: string;
  guidance: string;
  pinned: boolean;
  published_at: string;
  expires_at: string | null;
  archived_at: string | null;
  acknowledged_at: string | null;
  acknowledged_count: number | null;
  member_count: number | null;
};
export type NoticePage = { total: number; notices: TeamNotice[] };

export function noticeArticleLink(input: string): string | null {
  try {
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !["bleepingcomputer.com", "www.bleepingcomputer.com"].includes(
        url.hostname,
      ) ||
      url.username ||
      url.password ||
      url.port ||
      !url.pathname.startsWith("/news/") ||
      url.hash
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function adminNoticeOrganizations(
  userId: string,
): Promise<NoticeOrganization[]> {
  const client = supabase;
  if (!client) return [];
  const memberships = await collectOrganizationPages<{
    organization_id: string;
  }>((from, to) =>
    client
      .from("cg_memberships")
      .select("organization_id", { count: "exact" })
      .eq("user_id", userId)
      .eq("role", "admin")
      .order("organization_id")
      .range(from, to),
  );
  if (!memberships.length) return [];
  return collectOrganizationPages<NoticeOrganization>((from, to) =>
    client
      .from("cg_organizations")
      .select("id,name", { count: "exact" })
      .is("archived_at", null)
      .in(
        "id",
        memberships.map((member) => member.organization_id),
      )
      .order("id")
      .range(from, to),
  );
}

export async function listTeamNotices(
  org: string,
  includeInactive: boolean,
  page: number,
): Promise<NoticePage> {
  if (!supabase) throw new Error("Team notices are unavailable.");
  const { data, error } = await supabase.rpc("cg_list_team_notices", {
    org,
    include_inactive: includeInactive,
    page_offset: page * 10,
  });
  if (error) throw error;
  return data as NoticePage;
}

export async function countUnreadTeamNotices(
  org: string,
  userId: string,
): Promise<number> {
  const firstPage = await listTeamNotices(org, false, 0);
  const pages = await Promise.all(
    Array.from(
      { length: Math.max(0, Math.ceil(firstPage.total / 10) - 1) },
      (_, index) => listTeamNotices(org, false, index + 1),
    ),
  );
  const articleUnread = [firstPage, ...pages].reduce(
    (count, page) =>
      count +
      page.notices.filter(
        (notice) =>
          !notice.acknowledged_at &&
          !notice.archived_at &&
          (!notice.expires_at || Date.parse(notice.expires_at) > Date.now()),
      ).length,
    0,
  );
  if (!supabase) return articleUnread;

  const { data: announcements, error } = await supabase
    .from("cg_general_announcements")
    .select("id,expires_at,archived_at")
    .eq("organization_id", org);
  if (error) throw error;
  const activeAnnouncements = (announcements ?? []).filter(
    (announcement) =>
      !announcement.archived_at &&
      (!announcement.expires_at ||
        Date.parse(announcement.expires_at) > Date.now()),
  );
  if (!activeAnnouncements.length) return articleUnread;

  const { data: acknowledgements, error: acknowledgementError } =
    await supabase
      .from("cg_general_announcement_acknowledgements")
      .select("announcement_id")
      .eq("user_id", userId)
      .in(
        "announcement_id",
        activeAnnouncements.map((announcement) => announcement.id),
      );
  if (acknowledgementError) throw acknowledgementError;
  return articleUnread + activeAnnouncements.length - (acknowledgements ?? []).length;
}
