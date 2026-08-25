module.exports = {
  ci: {
    collect: {
      url: [
        'http://127.0.0.1:3000/ar',
        'http://127.0.0.1:3000/en',
        'http://127.0.0.1:3000/ar/properties',
        'http://127.0.0.1:3000/en/properties',
      ],
      numberOfRuns: 2,
      settings: {
        preset: 'mobile',
        budgets: require('./lighthouse-budget.json'),
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['warn', { minScore: 0.85 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.9 }],
        'categories:seo': ['error', { minScore: 0.95 }],
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
        'total-blocking-time': ['warn', { maxNumericValue: 300 }],
        'resource-summary:script:size': ['warn', { maxNumericValue: 200000 }],
      },
    },
    upload: { target: 'filesystem', outputDir: './lighthouse-report' },
  },
};
