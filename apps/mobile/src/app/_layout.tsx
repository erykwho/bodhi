import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AppDataProvider } from "../state/AppDataContext";
import { I18nProvider } from "../state/I18nContext";
import { ThemeProvider, useBodhiTheme } from "../state/ThemeContext";

function RootNavigator() {
  const { mode, colors } = useBodhiTheme();

  return (
    <>
      <StatusBar style={mode === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="settings"
          options={{ presentation: "modal", animation: "slide_from_bottom" }}
        />
        <Stack.Screen
          name="player/[id]"
          options={{
            presentation: "fullScreenModal",
            animation: "slide_from_bottom",
          }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nProvider>
            <AppDataProvider>
              <RootNavigator />
            </AppDataProvider>
          </I18nProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
