module.exports = {
  ci: {
    collect: {
      url: ['http://127.0.0.1:3000/ar', 'http://127.0.0.1:3000/en'],
      numberOfRuns: 3,
      settings: {
        preset: 'desktop',
        budgets: require('./lighthouse-budget.json'),
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.9 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 0.95 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2000 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
        'resource-summary:script:size': ['error', { maxNumericValue: 153600 }],
      },
    },
    upload: { target: 'filesystem', outputDir: './lighthouse-report' },
  },
};
