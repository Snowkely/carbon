export default () => {
  const classroom = process.env.CLASSROOM_BUILD === "true";
  const classroomWeb = process.env.CLASSROOM_WEB_BUILD === "true";

  return {
    name: "Carbon Trader I",
    slug: "carbon-trader-i",
    version: "0.1.0",

    orientation: "portrait" as const,
    userInterfaceStyle: "light" as const,

    scheme: "carbontrader",

    extra: {
      classroomBuild: classroom,
      classroomWeb,
      eas: {
        projectId: "ba6465df-cac8-486d-ab31-fb5ef6a23e72"
      }
    },

    android: {
      package: "org.carbontrader.explorer",
      versionCode: 1,

      intentFilters: [{
        action: "VIEW",
        autoVerify: false,
        data: [
          {
            scheme: "carbontrader",
            host: "connect"
          }
        ],
        category: ["BROWSABLE", "DEFAULT"]
      }]
    },

    ios: {
      bundleIdentifier: "org.carbontrader.explorer",

      infoPlist: classroom
        ? {
            NSAppTransportSecurity: {
              NSAllowsLocalNetworking: true
            },
            NSLocalNetworkUsageDescription:
              "Carbon Trader connects to the classroom server on your local Wi-Fi network."
          }
        : {}
    },

    web: {
      output: "single" as const,
      name: "Carbon Trader I Student",
      shortName: "CarbonTrader",
      description: "Carbon Trader I student classroom experience",
      themeColor: "#053c21",
      backgroundColor: "#f7faf7"
    },

    experiments: classroomWeb ? { baseUrl: "/student" } : undefined,

    plugins: [
      "expo-status-bar",

      [
        "expo-splash-screen",
        {
          backgroundColor: "#f7faf7",
          image: "./assets/splash-icon.png",
          imageWidth: 200,
          resizeMode: "contain"
        }
      ],

      ...(classroom
        ? [
            [
              "expo-build-properties",
              {
                android: {
                  usesCleartextTraffic: true
                }
              }
            ]
          ]
        : [])
    ]
  };
};
