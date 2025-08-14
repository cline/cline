/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL || 'https://roocode.com',
  generateRobotsTxt: true,
  generateIndexSitemap: false, // We don't need index sitemap for a small site
  changefreq: 'monthly',
  priority: 0.7,
  sitemapSize: 5000,
  exclude: [
    '/api/*',
    '/server-sitemap-index.xml',
    '/404',
    '/500',
    '/_not-found',
  ],
  robotsTxtOptions: {
    policies: [
      {
        userAgent: '*',
        allow: '/',
      },
    ],
    additionalSitemaps: [
      // Add any additional sitemaps here if needed in the future
    ],
  },
  // Custom transform function to set specific priorities and change frequencies
  transform: async (config, path) => {
    // Set custom priority for specific pages
    let priority = config.priority;
    let changefreq = config.changefreq;
    
    if (path === '/') {
      priority = 1.0;
      changefreq = 'yearly';
    } else if (path === '/enterprise' || path === '/evals') {
      priority = 0.8;
      changefreq = 'monthly';
    } else if (path === '/privacy' || path === '/terms') {
      priority = 0.5;
      changefreq = 'yearly';
    }
    
    return {
      loc: path,
      changefreq,
      priority,
      lastmod: config.autoLastmod ? new Date().toISOString() : undefined,
      alternateRefs: config.alternateRefs ?? [],
    };
  },
  additionalPaths: async (config) => {
    // Add any additional paths that might not be automatically discovered
    // This is useful for dynamic routes or API-generated pages
    // Add the /evals page since it's a dynamic route
    return [{
      loc: '/evals',
      changefreq: 'monthly',
      priority: 0.8,
      lastmod: new Date().toISOString(),
    }];
    
    // Add the /evals page since it's a dynamic route
    result.push({
      loc: '/evals',
      changefreq: 'monthly',
      priority: 0.8,
      lastmod: new Date().toISOString(),
    });
    
    return result;
  },
};