import { Button } from "./button"

export default {
  title: "Button",
  component: Button,
}

export const Primary = {
  args: {
    children: "Button",
    variant: "primary",
  },
}

export const Secondary = {
  args: {
    children: "Button",
    variant: "secondary",
  },
}

export const WithShortcut = {
  args: {
    children: "Save",
    shortcut: ["⌘", "⏎"],
  },
}