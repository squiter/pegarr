import type { FeasibilityInput } from "../domain.js";

export const demoFeasibilityInput: FeasibilityInput = {
  fixture: "synthetic-sonarr-episode-v1",
  item: {
    kind: "episode",
    title: "Example Show — S03E05",
    season: 3,
    episode: 5,
    ids: { tvdb: "900005" },
  },
  policy: {
    source: "bazarr",
    profileId: "profile-7",
    profileName: "Original plus Brazilian Portuguese",
    languages: [
      { code: "pt-BR", required: true, forced: false, hearingImpaired: "either" },
      { code: "en", required: false, forced: false, hearingImpaired: "avoid" },
    ],
  },
  releases: [
    {
      id: "sonarr-release-1",
      title: "Example.Show.S03E05.1080p.WEB-DL.H264-GROUP",
      downloadAllowed: true,
      rejectionReasons: [],
      customFormatScore: 100,
    },
    {
      id: "sonarr-release-2",
      title: "Example.Show.S03E05.1080p.WEB.H264-OTHER",
      downloadAllowed: true,
      rejectionReasons: [],
      customFormatScore: 0,
      traits: { source: "WEB-DL", resolution: "1080p", codec: "H.264", releaseGroup: "OTHER" },
    },
    {
      id: "sonarr-release-3",
      title: "Example.Show.S03E05.720p.HDTV.H264-OLD",
      downloadAllowed: false,
      rejectionReasons: ["Quality profile does not allow HDTV-720p"],
      customFormatScore: 0,
    },
    {
      id: "sonarr-release-4",
      title: "Example.Show.S03E05.2160p.WEB-DL.H265-NEW",
      downloadAllowed: true,
      rejectionReasons: [],
      customFormatScore: 0,
    },
  ],
  providerResults: [
    {
      provider: "subdl",
      status: "success",
      subtitles: [
        {
          id: "subdl-ptbr-group",
          provider: "subdl",
          language: "pt-BR",
          releaseName: "Example.Show.S03E05.1080p.WEB-DL.H264-GROUP",
          mediaIds: { tvdb: "900005" },
          season: 3,
          episode: 5,
        },
        {
          id: "subdl-ptbr-old",
          provider: "subdl",
          language: "pt_br",
          releaseName: "Example.Show.S03E05.720p.HDTV.H264-OLD",
          mediaIds: { tvdb: "900005" },
          season: 3,
          episode: 5,
        },
      ],
    },
    {
      provider: "opensubtitles",
      status: "rate_limited",
      subtitles: [],
      detail: "Synthetic quota-exhaustion fixture; no retry was attempted",
    },
  ],
};
