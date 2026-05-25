import fs from 'fs';
import path from 'path';
import os from 'os';

function findAndroidSdk() {

    const candidates = [
        process.env.ANDROID_HOME,
        process.env.ANDROID_SDK_ROOT,
        path.join(
            os.homedir(),
            'AppData',
            'Local',
            'Android',
            'Sdk'
        )
    ].filter(Boolean);

    for(const sdk of candidates){

        const adb=path.join(
            sdk,
            'platform-tools',
            'adb.exe'
        );

        if(fs.existsSync(adb)){
            return sdk;
        }
    }

    return null;
}