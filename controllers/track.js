const spotify = require('../helpers/spotify');
const logger = require('../helpers/logger');

module.exports = {

  getTrackAudioFeatures: async (req, res) => {
    try {
      const tracks = await spotify.findTracksWithoutAnalytics();
      if (!tracks.length) return res.status(200).send({ status: true, message: 'All tracks have their analytics set' });
      await spotify.performAuthentication();
      spotify.getAudioAnalyticsForTracks(tracks);
      return res.status(200).send({
        status: true,
        message: 'Populating analytics...',
      });
    } catch (err) {
      logger.error(err);
      return res.status(500).send({ message: 'An error occurred' });
    }
  },

  getTrackPreviews: async (req, res) => {
    try {
      const tracks = await spotify.findTracksWithoutPreview();
      if (!tracks.length) return res.status(200).send({ status: true, message: 'All tracks have their previews set' });
      await spotify.performAuthentication();
      await spotify.getPreviewUrlForTracks(tracks);
      return res.status(200).send({
        status: true,
        message: 'Populating previews...',
      });
    } catch (err) {
      logger.error(err);
      return res.status(500).send({ message: 'An error occurred' });
    }
  },

  getTrackData: async (req, res) => {
    try {
      const { track_ids: ids } = req.body;

      const result = await spotify.performAuthentication();
      if (result && result.code === 401) {
        return res.status(401).send({ message: result.message });
      }

      const data = await spotify.getTrackData(ids);

      return res.status(200).send({
        status: true,
        data,
      });
    } catch (err) {
      logger.error(err);
      return res.status(500).send({ message: 'An error occurred' });
    }
  },
};
