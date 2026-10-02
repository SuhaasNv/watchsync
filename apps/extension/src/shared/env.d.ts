declare const __API_URL__: string;
declare const __MOCK__: boolean;
/** "dev" for the WatchSync Dev build testers use (DEC-026), else "prod". */
declare const __CHANNEL__: "dev" | "prod";
/** The dev build's short commit; empty in prod builds. */
declare const __BUILD__: string;
/** The WatchSync website for this channel (DEC-026). */
declare const __SITE_URL__: string;
/** Match patterns of the supported service pages; the only places an invite may redirect to. */
declare const __TITLE_PAGES__: string[];
