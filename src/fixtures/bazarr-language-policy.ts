export const syntheticBazarrLanguageProfilesResponse: readonly unknown[] = [
  {
    profileId: 7,
    name: "Multilingual primary",
    cutoff: 2,
    items: [
      {
        id: 1,
        language: "en",
        hi: "False",
        forced: "False",
        audio_exclude: "False",
        audio_only_include: "False",
      },
      {
        id: 2,
        language: "pt-BR",
        hi: "True",
        forced: "False",
        audio_exclude: "True",
        audio_only_include: "False",
      },
      {
        id: 3,
        language: "es",
        hi: "False",
        forced: "True",
        audio_exclude: "False",
        audio_only_include: "True",
      },
    ],
    mustContain: ["WEB", "BluRay"],
    mustNotContain: ["CAM"],
    originalFormat: 1,
    tag: "primary_media",
  },
  {
    profileId: 12,
    name: "Any French subtitle",
    cutoff: 65535,
    items: [
      {
        id: 4,
        language: "fr",
        hi: "False",
        forced: "False",
        audio_exclude: "False",
        audio_only_include: "False",
      },
    ],
    mustContain: [],
    mustNotContain: [],
    originalFormat: 0,
    tag: null,
  },
];

export const syntheticBazarrSeriesAssignmentResponse = {
  data: [
    {
      sonarrSeriesId: 42,
      profileId: 7,
      title: "Private Example Series",
      path: "/private/media/series/example",
      poster: "https://private.invalid/poster.jpg",
      overview: "Private library description",
      tags: ["private-tag"],
      audio_language: [{ code2: "en", name: "English" }],
    },
  ],
  total: 1,
};

export const syntheticBazarrMovieAssignmentResponse = {
  data: [
    {
      radarrId: 84,
      profileId: null,
      title: "Private Example Movie",
      path: "/private/media/movies/example",
      fanart: "https://private.invalid/fanart.jpg",
      subtitles: [{ path: "/private/subtitle.srt" }],
    },
  ],
  total: 1,
};
