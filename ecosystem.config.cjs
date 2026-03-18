module.exports = {
  apps: [
    {
      name: "dashpro-app",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
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
      env: {
        NODE_ENV: "production",
        BOT_PORT: "3010",
      },
    },
  ],
}
