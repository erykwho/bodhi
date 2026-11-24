import React from "react";
import Svg, { Path } from "react-native-svg";
import { useBodhiTheme } from "../../state/ThemeContext";

export function BodhiLogo({ size = 28 }: { size?: number }) {
  const { colors } = useBodhiTheme();

  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Path
        d="M32 6C22 18 12 28 12 40C12 50.5 20.5 56 32 56C43.5 56 52 50.5 52 40C52 28 42 18 32 6Z"
        fill={colors.accent}
        fillOpacity={0.18}
        stroke={colors.accent}
        strokeWidth={3}
        strokeLinejoin="round"
      />
      <Path
        d="M32 16V56M32 30L22 24M32 38L42 32M32 46L23 41"
        stroke={colors.accent}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    </Svg>
  );
}
