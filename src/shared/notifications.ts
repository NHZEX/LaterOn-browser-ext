export interface SystemNoticeResult {
  readonly status: "sent" | "permission-missing" | "blocked" | "unavailable" | "failed";
  readonly error?: string;
}

export const SYSTEM_NOTICE_MESSAGES: Readonly<Record<SystemNoticeResult["status"], string>> = {
  sent: "notificationsSent",
  "permission-missing": "notificationsTestPermissionMissing",
  blocked: "notificationsBlocked",
  unavailable: "notificationsUnavailable",
  failed: "notificationsSendFailed"
};
