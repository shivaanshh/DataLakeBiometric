const { withProjectBuildGradle } = require('@expo/config-plugins');

/**
 * Forces all Kotlin + kotlinx libraries to versions compatible with Kotlin 1.8.0.
 * react-native-gradle-plugin (RN 0.73) locks the buildscript compiler to Kotlin 1.8.0
 * for the entire build. Modern packages (vision-camera, worklets-core) pull in
 * kotlin-reflect:2.0.0 and kotlinx-coroutines:1.8.x (compiled with Kotlin 2.0),
 * which are unreadable by the 1.8.0 compiler.
 */
module.exports = function withKotlinVersion(config) {
  return withProjectBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('forceKotlinCompat')) {
      config.modResults.contents += `

// forceKotlinCompat: pin all Kotlin/kotlinx libs to Kotlin 1.8-compatible versions
subprojects {
    configurations.all {
        resolutionStrategy {
            force 'org.jetbrains.kotlin:kotlin-reflect:1.8.0'
            force 'org.jetbrains.kotlin:kotlin-stdlib:1.8.0'
            force 'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.0'
            force 'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.0'
            force 'org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3'
            force 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3'
            force 'org.jetbrains.kotlinx:kotlinx-coroutines-jvm:1.7.3'
        }
    }
}
`;
    }
    return config;
  });
};
