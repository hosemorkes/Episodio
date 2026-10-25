import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Единый .env в корне проекта: логин, пароль и секрет сессии берутся оттуда
// forceReload обязателен: Next уже загрузил .env из frontend/ и без него вернёт кеш, не читая корень
loadEnvConfig(path.resolve(__dirname, ".."), process.env.NODE_ENV !== "production", console, true);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
