import { d as useNavigate, j as jsxRuntime, m as motion } from "./index-61723096.js";
import { N as Navbar } from "./Navbar-61723096.js";
import "./WatchPartyOverlay-61723096.js";

const DISCORD_INVITE_URL = "https://discord.gg/v87gDSVK5x";
const DISCORD_ICON_PATH =
  "M20.317 4.369A19.791 19.791 0 0 0 15.885 3c-.191.328-.403.775-.553 1.124a18.27 18.27 0 0 0-5.134 0A11.713 11.713 0 0 0 9.645 3a19.736 19.736 0 0 0-4.433 1.369C2.41 8.598 1.652 12.723 2.03 16.79a19.9 19.9 0 0 0 5.429 2.74c.439-.603.83-1.24 1.165-1.911-.627-.238-1.224-.529-1.775-.867.149-.111.294-.225.434-.343 3.425 1.607 7.15 1.607 10.535 0 .142.118.287.232.434.343-.552.338-1.15.63-1.778.867.336.671.727 1.308 1.167 1.911a19.88 19.88 0 0 0 5.431-2.74c.444-4.713-.76-8.8-3.755-12.421ZM9.048 14.75c-1.029 0-1.875-.936-1.875-2.084 0-1.148.826-2.084 1.875-2.084 1.058 0 1.894.945 1.875 2.084 0 1.148-.827 2.084-1.875 2.084Zm5.905 0c-1.029 0-1.875-.936-1.875-2.084 0-1.148.826-2.084 1.875-2.084 1.058 0 1.894.945 1.875 2.084 0 1.148-.817 2.084-1.875 2.084Z";

function DiscordIcon(className) {
  return jsxRuntime.jsx("svg", {
    xmlns: "http://www.w3.org/2000/svg",
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    fill: "currentColor",
    className,
    children: jsxRuntime.jsx("path", { d: DISCORD_ICON_PATH })
  });
}

function BackupDomainsPage() {
  const navigate = useNavigate();

  function openDiscord() {
    window.open(DISCORD_INVITE_URL, "_blank", "noopener,noreferrer");
  }

  return jsxRuntime.jsxs(jsxRuntime.Fragment, {
    children: [
      jsxRuntime.jsx(Navbar, {}),
      jsxRuntime.jsx("div", {
        className: "min-h-screen flex items-center justify-center bg-black/95 p-4 pt-20",
        children: jsxRuntime.jsxs(motion.div, {
          initial: { opacity: 0, scale: 0.95 },
          animate: { opacity: 1, scale: 1 },
          className:
            "w-full max-w-lg bg-black/50 backdrop-blur-sm rounded-xl border border-white/10 p-6 shadow-2xl",
          children: [
            jsxRuntime.jsxs("div", {
              className: "text-center mb-6",
              children: [
                jsxRuntime.jsx("div", {
                  className:
                    "w-16 h-16 mx-auto mb-4 rounded-full bg-[#5865F2]/20 flex items-center justify-center text-[#5865F2]",
                  children: DiscordIcon("w-8 h-8")
                }),
                jsxRuntime.jsx("h1", {
                  className: "text-2xl font-bold text-white mb-2",
                  children: "Backup Domains"
                }),
                jsxRuntime.jsx("p", {
                  className: "text-white/70",
                  children: "Use Discord for working links, updates, and support."
                })
              ]
            }),
            jsxRuntime.jsxs(motion.div, {
              initial: { opacity: 0, y: 10 },
              animate: { opacity: 1, y: 0 },
              className: "p-5 bg-white/5 rounded-xl border border-white/10",
              children: [
                jsxRuntime.jsxs("div", {
                  className: "flex items-start gap-4",
                  children: [
                    jsxRuntime.jsx("div", {
                      className:
                        "w-12 h-12 rounded-xl bg-[#5865F2] text-white flex items-center justify-center shrink-0",
                      children: DiscordIcon("w-6 h-6")
                    }),
                    jsxRuntime.jsxs("div", {
                      className: "flex-1 min-w-0",
                      children: [
                        jsxRuntime.jsx("h2", {
                          className: "text-white text-lg font-semibold mb-2",
                          children: "Join Our Discord"
                        }),
                        jsxRuntime.jsx("p", {
                          className: "text-white/70 text-sm leading-6",
                          children:
                            "Get the current working link, downtime updates, announcements, and support in one place."
                        })
                      ]
                    })
                  ]
                }),
                jsxRuntime.jsxs("button", {
                  "data-discord-primary-cta": "true",
                  onClick: openDiscord,
                  className:
                    "mt-5 inline-flex w-full items-center justify-center gap-3 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] text-white font-medium px-4 py-3 transition-colors",
                  children: [DiscordIcon("w-5 h-5"), jsxRuntime.jsx("span", { children: "Join Our Discord" })]
                }),
                jsxRuntime.jsx("p", {
                  className: "mt-4 text-center text-sm text-white/50",
                  children: "The Discord server is now the only source for updated links."
                })
              ]
            }),
            jsxRuntime.jsx("button", {
              onClick: function () {
                navigate("/");
              },
              className:
                "w-full py-2 px-4 bg-white/10 hover:bg-white/20 text-white rounded-lg transition-colors mt-6",
              children: "Back to Home"
            })
          ]
        })
      })
    ]
  });
}

export { BackupDomainsPage as default };
