const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Adds -Xskip-metadata-version-check to every Kotlin compile task.
 *
 * Root cause: react-native-gradle-plugin (RN 0.73) pins the Kotlin compiler
 * to 1.8.0 for the entire build. Modern packages (vision-camera, worklets-core)
 * pull in kotlinx-coroutines and kotlin-reflect compiled with Kotlin 2.0, whose
 * binary metadata the 1.8 compiler refuses to read.
 *
 * The Gradle error itself says: "use '-Xskip-metadata-version-check' to suppress"
 * This flag lets the 1.8 compiler ignore the metadata version mismatch so it can
 * compile against 2.0-compiled libraries. The libraries stay at their original
 * versions, so VisionCamera and worklets work correctly at runtime.
 *
 * Previous approach (resolutionStrategy.force on kotlinx-coroutines:1.7.3) fixed
 * compilation but silently broke VisionCamera camera enumeration at runtime because
 * VisionCamera calls coroutine APIs that don't exist in 1.7.3.
 */
module.exports = function withKotlinVersion(config) {
  return withProjectBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('skipMetadataVersionCheck')) {
      config.modResults.contents += `

// skipMetadataVersionCheck: allow Kotlin 1.8 compiler to read 2.0-compiled deps
subprojects {
    tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
        kotlinOptions {
            freeCompilerArgs += ['-Xskip-metadata-version-check']
        }
    }
}
`;
    }
    return config;
  });
};
