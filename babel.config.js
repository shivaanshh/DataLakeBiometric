module.exports = {
  presets: ['babel-preset-expo'],
  plugins: [
    // Required for react-native-worklets-core — compiles 'worklet' functions
    // for the JSI worklet runtime used by VisionCamera frame processors
    'react-native-worklets-core/plugin',
  ],
};
