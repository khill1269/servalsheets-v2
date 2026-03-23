/**
 * PM2 Ecosystem Configuration
 *
 * Usage:
 *   Development: pm2 start ecosystem.config.js
 *   Production:  pm2 start ecosystem.config.js --env production
 *   Staging:     pm2 start ecosystem.config.js --env staging
 */

module.exports = {
  apps: [
    {
      // ========== HTTP Server (Recommended) ==========
      name: 'servalsheets-http',
      script: './dist/http-server.js',
      instances: 2,
      exec_mode: 'cluster',

      // Environment variables
      env: {
        NODE_ENV: 'development',
        HTTP_PORT: 3000,
        LOG_LEVEL: 'debug',
        LOG_FORMAT: 'pretty',
      },
      env_staging: {
        NODE_ENV: 'staging',
        HTTP_PORT: 3000,
        LOG_LEVEL: 'info',
        LOG_FORMAT: 'json',
      },
      env_production: {
        NODE_ENV: 'production',
        HTTP_PORT: 3000,
        LOG_LEVEL: 'info',
        LOG_FORMAT: 'json',
      },

      // Logging
      error_file: './logs/http-err.log',
      out_file: './logs/http-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Process management
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,
      kill_timeout: 5000,
      listen_timeout: 10000,

      // Monitoring
      instance_var: 'INSTANCE_ID',

      // Performance
      max_memory_restart: '2G',
      node_args: '--max-old-space-size=2048',
    },

    {
      // ========== Stdio Server (Claude Desktop) ==========
      name: 'servalsheets-stdio',
      script: './dist/cli.js',
      instances: 1,
      exec_mode: 'fork',

      env: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug',
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info',
      },

      // Logging
      error_file: './logs/stdio-err.log',
      out_file: './logs/stdio-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Process management
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,

      // Performance
      max_memory_restart: '1G',
    },

    {
      // ========== Remote Server (WebSocket) ==========
      name: 'servalsheets-remote',
      script: './dist/remote-server.js',
      instances: 2,
      exec_mode: 'cluster',

      env: {
        NODE_ENV: 'development',
        REMOTE_PORT: 8080,
        LOG_LEVEL: 'debug',
        LOG_FORMAT: 'pretty',
      },
      env_production: {
        NODE_ENV: 'production',
        REMOTE_PORT: 8080,
        LOG_LEVEL: 'info',
        LOG_FORMAT: 'json',
      },

      // Logging
      error_file: './logs/remote-err.log',
      out_file: './logs/remote-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,

      // Process management
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 4000,

      // Performance
      max_memory_restart: '2G',
      node_args: '--max-old-space-size=2048',
    },
  ],

  // ========== Deployment Configuration ==========
  deploy: {
    production: {
      user: 'deploy',
      host: ['prod-server-1', 'prod-server-2'],
      ref: 'origin/main',
      repo: 'git@github.com:your-org/servalsheets.git',
      path: '/opt/servalsheets',
      'post-deploy':
        'npm ci --production && npm run build && pm2 reload ecosystem.config.js --env production',
      env: {
        NODE_ENV: 'production',
      },
    },
    staging: {
      user: 'deploy',
      host: 'staging-server',
      ref: 'origin/develop',
      repo: 'git@github.com:your-org/servalsheets.git',
      path: '/opt/servalsheets-staging',
      'post-deploy': 'npm ci && npm run build && pm2 reload ecosystem.config.js --env staging',
      env: {
        NODE_ENV: 'staging',
      },
    },
  },
};
