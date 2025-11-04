const webpack = require('webpack');

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        buffer: require.resolve('buffer/'),
        assert: require.resolve('assert/'),
      };
      
      // Add support for TypeScript file extensions (ensure they're at the beginning)
      const extensions = webpackConfig.resolve.extensions || [];
      if (!extensions.includes('.ts')) {
        webpackConfig.resolve.extensions = ['.ts', '.tsx', ...extensions];
      }
      
      // Ignore dynamic import warnings for cipherpay-sdk (it's loaded via browser bundle)
      webpackConfig.ignoreWarnings = [
        ...(webpackConfig.ignoreWarnings || []),
        /Failed to parse source map/,
        /Module not found:.*cipherpay-sdk/,
      ];
      
      // Add Buffer to global scope
      webpackConfig.plugins = [
        ...(webpackConfig.plugins || []),
        new webpack.ProvidePlugin({
          Buffer: ['buffer', 'Buffer'],
        }),
      ];

      return webpackConfig;
    },
  },
};

