plugins {
    id("com.android.application") version "8.7.3"
}

android {
    namespace = "mx.nexocrm.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "mx.nexocrm.app"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
