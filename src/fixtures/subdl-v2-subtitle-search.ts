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
