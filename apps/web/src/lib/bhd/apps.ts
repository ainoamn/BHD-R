export type BhdAppMode = "identity" | "sso" | "browse";

export type BhdApp = {
  id: string;
  clientId: string | null;
  nameAr: string;
  nameEn: string;
  origin: string;
  startUrl: string | null;
  mode: BhdAppMode;
  enabled: boolean;
  mark: string;
  accent: string;
  soft: string;
};

export const BHD_APP_SWITCHER_SPEC = "bhd-appswitcher.v1";

export const BHD_APPS: BhdApp[] = [
  // mode "sso" فقط بعد التحقق أن GET {origin}/api/auth/bhd/start يعيد 302 إلى id.bhd-om.com
  // mode "browse" = فتح الأصل مباشرة (لا تنقّل صامت) حتى يكتمل تثبيت المنتج — انظر docs/BHD-PRODUCT-SSO-ADMIN.md
  {
    id: "account",
    clientId: null,
    nameAr: "الحساب",
    nameEn: "Account",
    origin: "https://id.bhd-om.com",
    startUrl: null,
    mode: "identity",
    enabled: true,
    mark: "حـ",
    accent: "#092d24",
    soft: "#e8f4f1",
  },
  {
    id: "portal",
    clientId: "bhd-portal",
    nameAr: "البوابة",
    nameEn: "Portal",
    origin: "https://www.bhd-om.com",
    startUrl: "https://www.bhd-om.com/api/auth/bhd/start?returnTo=/",
    mode: "sso",
    enabled: true,
    mark: "B",
    accent: "#075c45",
    soft: "#e6f1ec",
  },
  {
    id: "wazen",
    clientId: "bhd-wazen",
    nameAr: "وازن",
    nameEn: "WAZEN",
    origin: "https://wazen.bhd-om.com",
    startUrl: "https://wazen.bhd-om.com/api/auth/bhd/start?returnTo=/",
    mode: "browse",
    enabled: true,
    mark: "و",
    accent: "#126b63",
    soft: "#e8f4f1",
  },
  {
    id: "hisaby",
    clientId: "bhd-hisaby",
    nameAr: "حسابي",
    nameEn: "HISAB",
    origin: "https://hisaby.bhd-om.com",
    startUrl: "https://hisaby.bhd-om.com/api/auth/bhd/start?returnTo=/",
    mode: "sso",
    enabled: true,
    mark: "ح",
    accent: "#075c45",
    soft: "#e6f1ec",
  },
  {
    id: "nasab",
    clientId: "bhd-nasab",
    nameAr: "نَسَب",
    nameEn: "NASAB",
    origin: "https://nasab.bhd-om.com",
    startUrl: "https://nasab.bhd-om.com/api/auth/bhd/start?returnTo=/",
    mode: "sso",
    enabled: true,
    mark: "ن",
    accent: "#8a3c45",
    soft: "#f6e9eb",
  },
  {
    id: "baitak",
    clientId: "bhd-baitak",
    nameAr: "بيتك",
    nameEn: "BAITAK",
    origin: "https://baitak.bhd-om.com",
    startUrl: "https://baitak.bhd-om.com/api/auth/bhd/start?returnTo=/",
    mode: "browse",
    enabled: true,
    mark: "ب",
    accent: "#a66b2d",
    soft: "#f8efe4",
  },
  {
    id: "bhd-r",
    clientId: "bhd-r",
    nameAr: "BHD R",
    nameEn: "BHD R",
    origin: "https://r.bhd-om.com",
    startUrl: "https://bhd-r-api-phi.vercel.app/api/auth/bhd/start?returnTo=/",
    // Keep browse in ONE-BHD until they verify start→authorize; local copy uses sso for self-links
    mode: "sso",
    enabled: true,
    mark: "R",
    accent: "#a66b2d",
    soft: "#f8efe4",
  },
  {
    id: "store",
    clientId: "bhd-store",
    nameAr: "المتجر",
    nameEn: "BHD Store",
    origin: "https://bhdstor.bhd-om.com",
    startUrl: "https://bhdstor.bhd-om.com/api/auth/bhd/start?returnTo=/",
    mode: "sso",
    enabled: true,
    mark: "م",
    accent: "#315d89",
    soft: "#e9f0f7",
  },
  {
    id: "office",
    clientId: "bhd-office",
    nameAr: "المكتب",
    nameEn: "BHD Office",
    origin: "https://baitak.bhd-om.com",
    startUrl: "https://baitak.bhd-om.com/api/auth/bhd/start?returnTo=/",
    mode: "sso",
    enabled: true,
    mark: "B",
    accent: "#283b4d",
    soft: "#e9edf0",
  },
];
