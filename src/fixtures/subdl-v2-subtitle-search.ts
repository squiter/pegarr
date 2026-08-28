export const syntheticSubdlV2EpisodeSearchResponse = {
  status: true,
  results: [
    {
      sd_id: "synthetic-title-id",
      type: "tv",
      name: "Synthetic Show",
      year: 2024,
      imdb_id: "tt9000005",
      tmdb_id: 900_005,
      poster_url: "https://private.invalid/poster.jpg",
      url: "https://private.invalid/title",
    },
  ],
  subtitles: [
    {
      n_id: "synthetic-subtitle-normal",
      release_name: "Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP",
      language: "EN",
      season: 3,
      episode: 5,
      hi: false,
      full_season: false,
      url: "/subtitle/private-normal.zip",
      uploader: "private-uploader",
    },
    {
      n_id: "synthetic-subtitle-hi",
      releases: [
        "Synthetic.Show.S03E05.720p.WEB-DL.H264-OTHER",
        "Synthetic.Show.S03E05.1080p.BluRay.x265-ARCHIVE",
      ],
      lang: "English",
      season: 3,
      episode: 5,
      hearing_impaired: true,
      full_season: false,
      url: "/subtitle/private-hi.zip",
      comment: "private comment",
    },
  ],
};

export const syntheticSubdlV2MovieSearchResponse = {
  status: true,
  results: [
    {
      sd_id: "synthetic-movie-id",
      type: "movie",
      name: "Synthetic Movie",
      year: 2025,
      tmdb_id: 84,
    },
  ],
  subtitles: [],
};

export const syntheticSubdlV2SeasonSearchResponse = {
  status: true,
  subtitles: [
    {
      n_id: "synthetic-subtitle-season-pack",
      release_name: "Example.Show.S03.1080p.WEB-DL.H264-GROUP",
      language: "PT-BR",
      season: 3,
      hi: true,
      forced: false,
      full_season: true,
      url: "/subtitle/private-season-pack.zip",
    },
    {
      n_id: "synthetic-subtitle-single-episode",
      release_name: "Example.Show.S03E05.1080p.WEB-DL.H264-OTHER",
      language: "PT-BR",
      season: 3,
      episode: 5,
      hi: false,
      forced: false,
      full_season: false,
    },
  ],
};

export const syntheticSubdlV2MultiEpisodeSearchResponse = {
  status: true,
  subtitles: [
    {
      n_id: "synthetic-subtitle-multi-episode",
      release_name: "Synthetic.Show.S03E05-E07.1080p.WEB-DL.H264-GROUP",
      language: "EN",
      season: 3,
      episode_from: 5,
      episode_end: 7,
      fps: "23.976",
      hi: false,
      forced: false,
      full_season: false,
      url: "/subtitle/private-multi-episode.zip",
      unpack_files: [{ file_n_id: "private-file-handle", url: "/private/file.srt" }],
    },
  ],
} as const;
