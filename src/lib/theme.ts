import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';

export const NAV_THEME: Record<'light' | 'dark', Theme> = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: 'hsl(0 0% 100%)',
      border: 'hsl(0 0% 89.8%)',
      card: 'hsl(0 0% 100%)',
      notification: 'hsl(0 84.2% 60.2%)',
      primary: 'hsl(0 0% 9%)',
      text: 'hsl(0 0% 3.9%)',
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: 'hsl(0 0% 3.9%)',
      border: 'hsl(0 0% 14.9%)',
      card: 'hsl(0 0% 3.9%)',
      notification: 'hsl(0 70.9% 59.4%)',
      primary: 'hsl(0 0% 98%)',
      text: 'hsl(0 0% 98%)',
    },
  },
};
