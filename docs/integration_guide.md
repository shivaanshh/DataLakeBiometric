# Integration Guide — Plugging into Datalake 3.0

This guide explains how to integrate the BiometricAuth module into an
existing React Native app (Datalake 3.0) with minimal code changes.

---

## 1. Copy the Source Files

```bash
# From this project, copy into your Datalake 3.0 project:

cp -r src/modules/     <datalake>/src/modules/biometric/
cp -r src/storage/db.ts             <datalake>/src/storage/biometricDb.ts
cp -r src/storage/syncManager.ts    <datalake>/src/storage/bioSyncManager.ts
cp -r src/utils/crypto.ts           <datalake>/src/utils/bioCrypto.ts
cp -r src/utils/imageProcessor.ts   <datalake>/src/utils/imageProcessor.ts
cp -r models/                       <datalake>/android/app/src/main/assets/
cp -r models/                       <datalake>/ios/<AppName>/models/

# Native modules
cp native/android/BiometricModule.java \
   <datalake>/android/app/src/main/java/com/<package>/BiometricModule.java

cp native/ios/BiometricModule.swift \
   <datalake>/ios/<AppName>/BiometricModule.swift
```

---

## 2. Install NPM Dependencies

Add to your existing `package.json` and run `npm install`:

```json
{
  "dependencies": {
    "react-native-vision-camera":      "^4.5.1",
    "react-native-fast-tflite":        "^1.3.0",
    "react-native-worklets-core":      "^1.3.3",
    "react-native-sqlite-storage":     "^6.0.1",
    "react-native-sensitive-info":     "^6.0.0-alpha.9",
    "@react-native-community/netinfo": "^11.3.1"
  }
}
```

```bash
npm install
cd ios && pod install && cd ..
```

---

## 3. Android Setup

### android/app/build.gradle
```gradle
android {
    defaultConfig {
        // Required for TFLite
        aaptOptions {
            noCompress "tflite", "task"
        }
    }
}

dependencies {
    implementation 'org.tensorflow:tensorflow-lite:2.14.0'
    implementation 'org.tensorflow:tensorflow-lite-support:0.4.4'
    implementation 'com.google.mediapipe:tasks-vision:0.10.14'
}
```

### android/app/src/main/AndroidManifest.xml
```xml
<uses-permission android:name="android.permission.CAMERA" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

### Register native module in MainApplication.java
```java
import com.datalakebiometric.BiometricPackage; // adjust package name

@Override
protected List<ReactPackage> getPackages() {
    return Arrays.asList(
        new MainReactPackage(),
        new BiometricPackage()   // ← add this
    );
}
```

---

## 4. iOS Setup

### ios/Podfile
```ruby
pod 'TensorFlowLiteSwift',   '~> 2.14.0'
pod 'MediaPipeTasksVision',  '~> 0.10.14'
```

### ios/<AppName>/Info.plist
```xml
<key>NSCameraUsageDescription</key>
<string>Required for facial recognition authentication of field personnel.</string>
```

### Register module in AppDelegate.m
```objc
// AppDelegate.m
#import "BiometricModule.h"
// Module is auto-registered via RCT_EXTERN_MODULE macro in Swift bridging header.
```

---

## 5. Add to Your App Navigation

### React Native Navigation (RNN) example
```typescript
// src/navigation/AppNavigator.tsx
import AuthScreen    from '../modules/biometric/screens/AuthScreen';
import EnrollScreen  from '../modules/biometric/screens/EnrollScreen';

// Add to your stack:
<Stack.Screen name="Enroll"       component={EnrollScreen} />
<Stack.Screen name="Authenticate" component={AuthScreen} />
```

### Usage in your existing attendance flow
```typescript
// In your existing AttendanceScreen or wherever you log attendance:
import { biometricAuth } from './modules/biometric/BiometricAuth';
import { syncManager }   from './storage/bioSyncManager';

// App startup
await biometricAuth.initialize();
syncManager.startListening((result) => {
  console.log('Sync completed:', result);
});

// Navigate to auth
navigation.navigate('Authenticate', { userId: currentUser.id });
```

---

## 6. AWS Infrastructure Setup

Create these resources in your AWS account (ap-south-1 recommended for India):

### DynamoDB Table
```
Table name:     DatalakeAttendanceRecords
Partition key:  id (String)
Billing mode:   Pay-per-request (on-demand)

Attributes:
  id         String   - UUID
  userId     String   - Employee ID
  timestamp  Number   - Unix ms
  location   String   - GPS coordinates or location name
  deviceId   String   - Device identifier
  syncedAt   Number   - When synced to cloud
```

### S3 Bucket (optional — for audit log archival)
```
Bucket name:    datalake-biometric-sync-<accountid>
Region:         ap-south-1
Versioning:     enabled
Encryption:     SSE-S3 (AES-256)
Public access:  blocked
```

### IAM Policy (minimum permissions)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": "arn:aws:dynamodb:ap-south-1:*:table/DatalakeAttendanceRecords"
    }
  ]
}
```

Use **AWS Cognito Identity Pools** (not hardcoded keys) for production:
```typescript
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';

const client = new DynamoDBClient({
  region:      'ap-south-1',
  credentials: fromCognitoIdentityPool({
    clientConfig: { region: 'ap-south-1' },
    identityPoolId: 'ap-south-1:your-identity-pool-id',
  }),
});
```

---

## 7. Permissions Check at Runtime

```typescript
// Call before launching any biometric screen
import { Camera } from 'react-native-vision-camera';

async function requestPermissions(): Promise<boolean> {
  const cameraStatus = await Camera.requestCameraPermission();
  return cameraStatus === 'granted';
}
```

---

## 8. Smoke Test Checklist

- [ ] App builds on Android without errors
- [ ] App builds on iOS without errors
- [ ] Camera opens on AuthScreen (physical device only)
- [ ] Console shows "BiometricModule initialized" on startup
- [ ] Enroll a test user → check SQLite for encrypted embedding row
- [ ] Authenticate → observe all 3 phases (DETECTING → LIVENESS → RECOGNIZING)
- [ ] Go offline → log attendance → verify record in SQLite with synced=0
- [ ] Restore network → verify record synced to DynamoDB → verify local purge
