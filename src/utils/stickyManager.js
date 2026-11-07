// stickyManager.js — shared logic for the /stickynote command and the messageCreate handler.
//
// Everything that reads or changes a channel's sticky note runs under one lock per
// channel, so a burst of messages can't post duplicate stickies and a late message
// handler can't bring back a note that was just removed.

import { PermissionFlagsBits } from 'discord.js';
import { getFromDb, setInDb, deleteFromDb } from './database.js';
import { Mutex } from './mutex.js';
import { logger } from './logger.js';

export const getStickyKey = (guildId, channelId) =>
    `stickynote:${guildId}:${channelId}`;

const withStickyLock = (channelId, task) =>
    Mutex.runExclusive(`stickynote:${channelId}`, task);

function canPost(channel) {
    const me = channel.guild?.members?.me;
    const permissions = me && channel.permissionsFor?.(me);

    // Can't tell (member not cached) - let the send attempt decide.
    if (!permissions) return true;

    const sendPermission = channel.isThread?.()
        ? PermissionFlagsBits.SendMessagesInThreads
        : PermissionFlagsBits.SendMessages;

    return permissions.has([PermissionFlagsBits.ViewChannel, sendPermission]);
}

// Discord IDs are time-ordered, so a larger ID means "posted later".
function isPostedAfter(stickyMessageId, messageId) {
    if (!stickyMessageId) return false;
    try {
        return BigInt(stickyMessageId) > BigInt(messageId);
    } catch {
        return false;
    }
}

// Must be called while holding the channel lock.
async function postSticky(channel, key, sticky) {
    if (sticky.messageId) {
        await channel.messages.delete(sticky.messageId).catch(() => {});
    }

    const sent = await channel.send({
        content: sticky.content,
        allowedMentions: { parse: [] }
    });

    await setInDb(key, { ...sticky, messageId: sent.id });
    return sent;
}

export async function getSticky(guildId, channelId) {
    return getFromDb(getStickyKey(guildId, channelId), null);
}

/**
 * Saves the sticky note for a channel and posts it right away, replacing the old
 * sticky message if there was one.
 * Resolves to { saved, posted }.
 */
export async function setSticky(channel, guildId, content) {
    const key = getStickyKey(guildId, channel.id);

    return withStickyLock(channel.id, async () => {
        const existing = await getFromDb(key, null);
        const sticky = { content, messageId: existing?.messageId ?? null };

        const saved = await setInDb(key, sticky);
        if (!saved) return { saved: false, posted: false };

        if (!canPost(channel)) return { saved: true, posted: false };

        try {
            await postSticky(channel, key, sticky);
            return { saved: true, posted: true };
        } catch (error) {
            logger.error('Error posting sticky note after /stickynote set:', error);
            return { saved: true, posted: false };
        }
    });
}

/**
 * Removes the sticky note for a channel and deletes its message.
 * Resolves to true if there was a note to remove.
 */
export async function removeSticky(channel, guildId) {
    const key = getStickyKey(guildId, channel.id);

    return withStickyLock(channel.id, async () => {
        const existing = await getFromDb(key, null);
        if (!existing) return false;

        if (existing.messageId) {
            await channel.messages.delete(existing.messageId).catch(() => {});
        }

        await deleteFromDb(key);
        return true;
    });
}

/**
 * Called for every new user message: moves the sticky note back to the bottom of
 * the channel if the channel has one.
 */
export async function refreshSticky(message) {
    const { guild, channel } = message;
    if (!guild || !channel) return;

    const key = getStickyKey(guild.id, channel.id);

    // Cheap check first so channels without a sticky never wait on the lock.
    const preview = await getFromDb(key, null);
    if (!preview?.content) return;

    await withStickyLock(channel.id, async () => {
        // Read again inside the lock: the note may have been changed or removed
        // while this message was waiting.
        const sticky = await getFromDb(key, null);
        if (!sticky?.content) return;

        // An earlier handler already reposted the sticky below this message.
        if (isPostedAfter(sticky.messageId, message.id)) return;

        if (!canPost(channel)) return;

        await postSticky(channel, key, sticky);
    });
}
