import { Tabs } from "expo-router";
import { CalendarDays, Headphones, Timer } from "lucide-react-native";
import React from "react";
import { Platform } from "react-native";
import { useBodhiI18n } from "../../state/I18nContext";
import { useBodhiTheme } from "../../state/ThemeContext";

export default function TabsLayout() {
  const { colors } = useBodhiTheme();
  const { m } = useBodhiI18n();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.foregroundMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingTop: 6,
          height: Platform.OS === "ios" ? 84 : 64,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: m.nav.timer,
          tabBarIcon: ({ color, size }) => <Timer size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="guided"
        options={{
          title: m.nav.guided,
          tabBarIcon: ({ color, size }) => (
            <Headphones size={size - 2} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: m.nav.history,
          tabBarIcon: ({ color, size }) => (
            <CalendarDays size={size - 2} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
