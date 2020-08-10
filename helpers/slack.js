const axios = require('axios');
const { slack: slackConfig, spotify: spotifyConfig } = require('../config');
const Contributor = require('../models/contributor');
const spotify = require('./spotify');
const logger = require('./logger');

module.exports = {
  /**
     * Recursive method that returns all messages from the slack channel
     * using Slack's API pagination.
     * @param {*} month
     * @param {*} cursor
     * @param {*} messages
     */
  async fetchChannelHistory(month, cursor, messages = []) {
    const startTime = month.startOf('month')
      .format('X.SSSSSS');
    const endTime = month.endOf('month')
      .format('X.SSSSSS');

    let url = `https://slack.com/api/conversations.history?token=${slackConfig.token}&channel=${slackConfig.sourceChannel}&oldest=${startTime}&latest=${endTime}&inclusive=true&pretty=1`;

    // point the slack api to the new batch we want to fetch
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    const history = await axios.get(url)
      .then((response) => response.data);

    // register new messages
    history.messages = messages.concat(history.messages);

    // check for more messages
    if (history.has_more) {
      const nextCursor = history.response_metadata ? history.response_metadata.next_cursor : null;
      if (!nextCursor) {
        return history;
      }
      return this.fetchChannelHistory(month, nextCursor, history.messages);
    }

    return history;
  },

  filterSpotifyMessages(messages) {
    const spotifyMessages = [];
    messages.forEach((msg) => {
      if (msg.attachments && msg.attachments.length) {
        msg.attachments.forEach((attachment) => {
          if (attachment.service_name === 'Spotify') {
            // attachment.service_name === "YouTube") {
            spotifyMessages.push({
              service: attachment.service_name,
              title: attachment.title,
              link: attachment.title_link,
              user: msg.user,
            });
          }
        });
      }
    });
    return spotifyMessages;
  },

  /**
   * Remove duplicate tracks.
   * @param {object} spotifyMessages
   */
  filterSpotifyTracks(spotifyMessages) {
    const tracks = [];
    spotifyMessages.forEach((message) => {
      const { mediaType, trackId } = spotify.getSpotifyUrlParts(message.link);
      if (mediaType === 'track') {
        if (!tracks.some((t) => t.id === trackId)) {
          tracks.push({
            service: message.service,
            title: message.title,
            link: message.link,
            users: [message.user],
            id: trackId,
          });
        } else {
          // add multiple contributors to one track
          const idx = tracks.findIndex((t) => t.id === trackId);
          if (idx > -1) tracks[idx].users.push(message.user);
        }
      }
    });
    return tracks;
  },

  createPlaylist(token, name, description) {
    const url = 'https://api.spotify.com/v1/playlists';
    const headers = {
      Authorization: `Bearer ${spotifyConfig.token}`,
    };
    return axios.post(url, {
      name,
      description,
      public: true,
    }, {
      headers,
    })
      .then((response) => response.data);
  },

  getSpotifyToken() {
    const encodedToken = Buffer.from(`${spotifyConfig.clientId}:${spotifyConfig.clientToken}`)
      .toString('base64');
    return {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${encodedToken}`,
    };
  },

  sendErrorMessage(message) {
    const channel = slackConfig.monitorChannel;

    if (!channel) {
      logger.info('Slack monitor channel not set.');
      return null;
    }

    return this.sendMessage(message, channel);
  },

  sendMessage(message, channel = slackConfig.targetChannel) {
    const url = 'https://slack.com/api/chat.postMessage';
    const headers = {
      Authorization: `Bearer ${slackConfig.token}`,
      'Content-Type': 'application/json',
    };

    return axios.post(url, {
      channel,
      text: message,
    }, { headers })
      .then((response) => response.data);
  },

  /**
   * @param {object} tracksData
   */
  async saveContributors(tracksData) {
    const url = `https://slack.com/api/users.info?token=${slackConfig.token}&user=`;

    const users = tracksData.reduce((acc, t) => acc.concat(t.users), []);
    const contributors = await Promise.all(users.map(async (user) => {
      const data = await axios.get(url + user).then((response) => response.data);
      const contributor = await Contributor.findOneAndUpdate(
        { slackId: user },
        {
          name: data.user.profile.real_name,
          about: data.user.profile.title,
          profile_image: data.user.profile.image_original,
          slackId: user,
        },
        { new: true, upsert: true },
      );

      return contributor;
    }));
    const uniqueContributors = [
      ...new Map(contributors.filter((c) => c !== null).map((c) => [c.slackId, c])).values(),
    ];

    return uniqueContributors;
  },
};
