export const syntheticOpenSubtitlesEpisodeSearchResponse = {
  total_pages: 1,
  total_count: 2,
  per_page: 50,
  page: 1,
  data: [
    {
      id: "private-result-101",
      type: "subtitle",
      attributes: {
        subtitle_id: "private-subtitle-101",
        language: "en",
        hearing_impaired: false,
        foreign_parts_only: false,
        release: "Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP",
        comments: "private comment",
        url: "https://www.opensubtitles.com/private/result/101",
        uploader: { uploader_id: 99, name: "private uploader" },
        files: [
          {
            file_id: 700_001,
            cd_number: 1,
            file_name: "Synthetic.Show.S03E05.1080p.WEB-DL.H264-GROUP.srt",
          },
        ],
      },
    },
    {
      id: "private-result-102",
      type: "subtitle",
      attributes: {
        subtitle_id: "private-subtitle-102",
        language: "en",
        hearing_impaired: true,
        foreign_parts_only: true,
        release: "Synthetic.Show.S03E05.720p.WEB-DL.H264-OTHER",
        url: "https://www.opensubtitles.com/private/result/102",
        files: [
          {
            file_id: 700_002,
            cd_number: 1,
            file_name: "Synthetic.Show.S03E05.720p.WEB-DL.H264-OTHER.ass",
          },
        ],
      },
    },
  ],
} as const;

export const syntheticOpenSubtitlesEmptySearchResponse = {
  total_pages: 0,
  total_count: 0,
  per_page: 50,
  page: 1,
  data: [],
} as const;
