module.exports = {
  apps: [
    {
      name: 'automation',
      script: 'vendors/runAutomation.js',
      cwd: __dirname,

      // Auto-restart settings
      autorestart: true,           // Auto-restart on crash
      watch: false,                // Don't restart on file changes
      max_restarts: 50,            // Max restarts before giving up
      min_uptime: 10000,           // Process must run 10s before considered "started"
      restart_delay: 5000,         // Wait 5 seconds before restart

      // Memory management
      max_memory_restart: '2G',    // Restart if memory exceeds 2GB

      // Logs
      error_file: 'logs/automation-error.log',
      out_file: 'logs/automation-out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Environment
      env: {
        NODE_ENV: 'production',
      },

      // Crash recovery - exponential backoff
      exp_backoff_restart_delay: 1000, // Start with 1s, doubles each restart
    }
  ]
};
