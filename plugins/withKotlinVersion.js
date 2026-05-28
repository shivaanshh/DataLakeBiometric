const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Forces kotlin-reflect to 1.8.0 across all subprojects via Gradle resolutionStrategy.
 *
 * Root cause: react-native-gradle-plugin (RN 0.73) locks the buildscript Kotlin compiler
 * to 1.8.0 for the entire build. react-native-vision-camera and worklets-core pull in
 * kotlin-reflect:2.0.0 as a transitive dep, which the 1.8.0 compiler cannot read.
 * Forcing kotlin-reflect to 1.8.0 makes the compiler and library versions consistent.
 */
module.exports = function withKotlinVersion(config) {
  return withProjectBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('forceKotlinReflect')) {
      config.modResults.contents += `

// forceKotlinReflect: pin kotlin-reflect to 1.8.0 so the Kotlin 1.8 compiler
// (forced by react-native-gradle-plugin) can read its metadata.
subprojects {
    configurations.all {
        resolutionStrategy {
            force 'org.jetbrains.kotlin:kotlin-reflect:1.8.0'
            force 'org.jetbrains.kotlin:kotlin-stdlib:1.8.0'
            force 'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.0'
            force 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.0'
        }
    }
}
`;
    }
    return config;
  });
};
