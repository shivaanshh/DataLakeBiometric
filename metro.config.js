const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Register .tflite files as assets so Metro bundles them into the APK
// and react-native-fast-tflite can load them via require()
config.resolver.assetExts.push('tflite');

module.exports = config;
