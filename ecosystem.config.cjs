module.exports = {
  apps: [
    {
      name: "dashpro-app",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start",
      autorestart: true,
      exp_backoff_restart_delay: 100,
      min_uptime: "10s",
      listen_timeout: 10000,
      kill_timeout: 5000,
      max_memory_restart: "700M",
      env: {
        NODE_ENV: "production",
        PORT: "3000",
      },
    },
    {
      name: "dashpro-bot",
      cwd: __dirname,
      script: "services/whatsapp-bot/bot.js",
      interpreter: "node",
      autorestart: true,
      exp_backoff_restart_delay: 100,
      min_uptime: "10s",
      kill_timeout: 5000,
      env: {
        NODE_ENV: "production",
        BOT_PORT: "3010",
      },
    },
  ],
}
