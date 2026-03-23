// VitePress Configuration
// @ts-check

/** @type {import('vitepress').UserConfig} */
export default {
  title: 'ServalSheets',
  description: 'Production-grade Google Sheets MCP Server',
  ignoreDeadLinks: true,

  head: [
    ['link', { rel: 'icon', href: '/favicon.ico' }],
    ['meta', { name: 'theme-color', content: '#5f6fd9' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'ServalSheets Documentation' }],
    [
      'meta',
      {
        property: 'og:description',
        content: 'Production-grade Google Sheets MCP Server with 25 tools and 397 actions',
      },
    ],
  ],

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: 'Guide', link: '/guides/FIRST_TIME_USER' },
      { text: 'API', link: '/reference/tools' },
      { text: 'Examples', link: '/examples/' },
      {
        text: 'Deploy',
        items: [
          { text: 'Docker', link: '/deployment/docker' },
          { text: 'Kubernetes', link: '/deployment/kubernetes' },
          { text: 'AWS', link: '/deployment/aws' },
          { text: 'GCP', link: '/deployment/gcp' },
        ],
      },
      {
        text: 'v1.7.0',
        items: [
          { text: 'Changelog', link: '/CHANGELOG' },
          { text: 'GitHub', link: 'https://github.com/khill1269/servalsheets' },
        ],
      },
    ],

    sidebar: {
      '/guides/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'First Time User', link: '/guides/FIRST_TIME_USER' },
            { text: 'Installation', link: '/guides/INSTALLATION_GUIDE' },
            { text: 'Claude Desktop Setup', link: '/guides/CLAUDE_DESKTOP_SETUP' },
            { text: 'Quick Credentials', link: '/guides/QUICKSTART_CREDENTIALS' },
          ],
        },
        {
          text: 'Usage',
          items: [
            { text: 'Usage Guide', link: '/guides/USAGE_GUIDE' },
            { text: 'Prompts Guide', link: '/guides/PROMPTS_GUIDE' },
            { text: 'Action Reference', link: '/guides/ACTION_REFERENCE' },
            { text: 'OAuth Setup', link: '/guides/OAUTH_USER_SETUP' },
          ],
        },
        {
          text: 'Production',
          items: [
            { text: 'Deployment', link: '/guides/DEPLOYMENT' },
            { text: 'Monitoring', link: '/guides/MONITORING' },
            { text: 'Performance', link: '/guides/PERFORMANCE' },
            { text: 'Troubleshooting', link: '/guides/TROUBLESHOOTING' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'API Reference',
          items: [
            { text: 'Tools Overview', link: '/reference/tools' },
            { text: 'sheets_data', link: '/reference/tools/sheets_data' },
            { text: 'sheets_structure', link: '/reference/tools/sheets_structure' },
            { text: 'sheets_formatting', link: '/reference/tools/sheets_formatting' },
            { text: 'sheets_analysis', link: '/reference/tools/sheets_analysis' },
            { text: 'sheets_charts', link: '/reference/tools/sheets_charts' },
          ],
        },
        {
          text: 'Resources',
          items: [
            { text: 'URI Templates', link: '/reference/resources' },
            { text: 'Knowledge Base', link: '/reference/knowledge' },
          ],
        },
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Basic Read/Write', link: '/examples/basic' },
            { text: 'Formatting', link: '/examples/formatting' },
            { text: 'Charts', link: '/examples/charts' },
            { text: 'Analysis', link: '/examples/analysis' },
            { text: 'OAuth Flow', link: '/examples/oauth' },
          ],
        },
      ],
      '/deployment/': [
        {
          text: 'Deployment',
          items: [
            { text: 'Overview', link: '/deployment/' },
            { text: 'Docker', link: '/deployment/docker' },
            { text: 'Kubernetes', link: '/deployment/kubernetes' },
            { text: 'Helm Chart', link: '/deployment/helm' },
            { text: 'AWS (Terraform)', link: '/deployment/aws' },
            { text: 'GCP (Terraform)', link: '/deployment/gcp' },
            { text: 'PM2', link: '/deployment/pm2' },
          ],
        },
        {
          text: 'Operations',
          items: [
            { text: 'Monitoring', link: '/guides/MONITORING' },
            { text: 'Scaling', link: '/operations/scaling' },
            { text: 'Disaster Recovery', link: '/operations/disaster-recovery' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/khill1269/servalsheets' }],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026 ServalSheets',
    },

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/khill1269/servalsheets/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },

  markdown: {
    lineNumbers: true,
  },

  sitemap: {
    hostname: 'https://servalsheets.dev',
  },
};
