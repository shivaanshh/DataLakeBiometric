import { registerRootComponent } from 'expo';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and also ensures the correct root component is used whether the app is loaded
// in Expo Go or as a native APK build.
registerRootComponent(App);
