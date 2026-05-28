const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Patches android/build.gradle to set ext.kotlinVersion = "2.0.0".
 * expo-build-properties writes kotlinVersion to gradle.properties instead,
 * but the Expo SDK 50 template reads it from build.gradle ext block.
 */
module.exports = function withKotlinVersion(config) {
  return withProjectBuildGradle(config, (config) => {
    const contents = config.modResults.contents;
    if (contents.includes('kotlinVersion')) {
      config.modResults.contents = contents.replace(
        /kotlinVersion\s*=\s*["'][^"']*["']/,
        'kotlinVersion = "2.0.0"'
      );
    } else {
      // Inject into ext block if not found
      config.modResults.contents = contents.replace(
        /ext\s*\{/,
        'ext {\n        kotlinVersion = "2.0.0"'
      );
    }
    return config;
  });
};
