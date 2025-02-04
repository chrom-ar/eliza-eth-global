import {
  createLightNode,
  createDecoder,
  createEncoder,
  bytesToUtf8,
  utf8ToBytes,
  Protocols,
  LightNode,
} from '@waku/sdk';
import { tcp } from '@libp2p/tcp';
import protobuf from 'protobufjs';
import { EventEmitter } from 'events';
import { WakuConfig } from './environment';
import { randomHexString, sleep } from './utils';

import { elizaLogger } from '@elizaos/core';

export const ChatMessage = new protobuf.Type('ChatMessage')
  .add(new protobuf.Field('timestamp', 1, 'uint64'))
  .add(new protobuf.Field('body', 2, 'bytes'))
  .add(new protobuf.Field('roomId', 3, 'bytes'));

export interface WakuMessageEvent {
  timestamp: number;
  body: any;
  roomId: string;
}

export class WakuClient extends EventEmitter {
  wakuConfig: WakuConfig;
  wakuNode: LightNode; // This will be the LightNode
  private subscriptionMap: Map<string, {
    subscription: any;
    expiration: number;
  }> = new Map();
  private timer: NodeJS.Timeout | null = null;

  constructor(wakuConfig: WakuConfig) {
    super();
    this.wakuConfig = wakuConfig;
  }

  async init() {
    const peers = this.wakuConfig.WAKU_STATIC_PEERS.split(',');

    if (peers.length > 0) {
      // NOTE: If other transports are needed we **have** to add them here
      this.wakuNode = await createLightNode({
        libp2p: { transports: [tcp()] }
      });

      for (let peer of peers) {
        // Dial fails sometimes
        for (let i = 0; i < 5; i++) {
          try {
            await this.wakuNode.dial(peer);
            elizaLogger.info(`[WakuBase] ${peer} connected`);
            break
          } catch (e) {
            elizaLogger.error(`[WakuBase] Error ${i} dialing peer ${peer}: ${e}`);
            await sleep(500)
          }
        }
      }
    } else {
      this.wakuNode = await createLightNode({ defaultBootstrap: true });
    }

    await this.wakuNode.start();

    // Wait for remote peer. This is repeated up to WAKU_PING_COUNT times.
    for (let i = 0; i < this.wakuConfig.WAKU_PING_COUNT; i++) {
      try {
        await this.wakuNode.waitForPeers([Protocols.LightPush, Protocols.Filter], 5000);

        if (this.wakuNode.isConnected()) {
          break;
        }
      } catch (e) {
        elizaLogger.info(`[WakuBase] Attempt ${i + 1}/${this.wakuConfig.WAKU_PING_COUNT} => still waiting for peers`);

        if (i === this.wakuConfig.WAKU_PING_COUNT - 1) {
          throw new Error('[WakuBase] Could not find remote peer after max attempts');
        }

        await sleep(500)
      }
    }

    elizaLogger.success('[WakuBase] Connected to Waku');
  }

  /**
   * Subscribe to the user-specified WAKU_CONTENT_TOPIC
   * If it contains the placeholder, we replace with the WAKU_TOPIC value, possibly with an appended random hex if so desired.
   */
  async subscribe(topic: string, fn: any, expirationSeconds: number = 20): Promise<void> {
    if (!topic) {
      if (!this.wakuConfig.WAKU_CONTENT_TOPIC || !this.wakuConfig.WAKU_TOPIC) {
        throw new Error('[WakuBase] subscription not configured (missing env). No messages will be received.');
      }
    }

    const subscribedTopic = this.buildFullTopic(topic);

    // @ts-ignore
    const { error, subscription } = await this.wakuNode.filter.createSubscription({
      // forceUseAllPeers: true,
      maxAttempts: 10,
      contentTopics: [subscribedTopic]
    });

    if (error) {
      throw new Error(`[WakuBase] Error creating subscription: ${error.toString()}`);
    }

    await subscription.subscribe(
      [createDecoder(subscribedTopic)],
      async (wakuMsg) => {
        if (!wakuMsg?.payload) {
          elizaLogger.error('[WakuBase] Received message with no payload');
          return;
        }

        let msgDecoded: any;

        try {
          msgDecoded = ChatMessage.decode(wakuMsg.payload);

          const event: WakuMessageEvent = {
            // @ts-ignore
            body: JSON.parse(bytesToUtf8(msgDecoded.body)),
            // @ts-ignore
            timestamp: Number(msgDecoded.timestamp),
            // @ts-ignore
            roomId: bytesToUtf8(msgDecoded.roomId)
          };

          await fn(event);
        } catch (err) {
          elizaLogger.error('[WakuBase] Error decoding message payload:', err, msgDecoded);
        }
      }
    );

    // Attempt a 'ping' to ensure it is up
    for (let i = 0; i < this.wakuConfig.WAKU_PING_COUNT; i++) {
      try {
        await subscription.ping();
        break;
      } catch (e) {
        if (e instanceof Error && e.message.includes('peer has no subscriptions')) {
          elizaLogger.warn('[WakuBase] Peer has no subs, retrying subscription...');
          return this.subscribe(topic, fn);
        }
        elizaLogger.warn(`[WakuBase] Subscription ping attempt ${i} error, retrying...`);

        await sleep(500);
      }
    }

    elizaLogger.success(`[WakuBase] Subscribed to topic: ${subscribedTopic}`);

    // Save subscription to check expiration
    this.subscriptionMap.set(subscribedTopic, {
      subscription: subscription,
      expiration: Date.now() + expirationSeconds * 1000
    });
  }

  async sendMessage(body: object, topic: string, roomId: string): Promise<void> {
    topic = this.buildFullTopic(topic);
    elizaLogger.info(`[WakuBase] Sending message to topic ${topic} =>`, body);

    const protoMessage = ChatMessage.create({
      timestamp: Date.now(),
      roomId:    utf8ToBytes(roomId),
      body:      utf8ToBytes(JSON.stringify(body)),
    });

    try {
      await this.wakuNode.lightPush.send(
        createEncoder({ contentTopic: topic }),
        { payload: ChatMessage.encode(protoMessage).finish() }
      );
      elizaLogger.success('[WakuBase] Message sent!');
    } catch (e) {
      elizaLogger.error('[WakuBase] Error sending message:', e);
    }
  }

  async unsubscribe(topic: string): Promise<void> {
    if (this.wakuNode) {
      const subscribedTopic = this.buildFullTopic(topic);
      const subscription = this.subscriptionMap.get(subscribedTopic);

      if (subscription) {
        elizaLogger.info(`[WakuBase] Unsubscribing from topic: ${subscribedTopic}`);
        await subscription.subscription.unsubscribe();
        this.subscriptionMap.delete(subscribedTopic);
      } else {
        elizaLogger.warn(`[WakuBase] No subscription found for topic: ${subscribedTopic}`);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.wakuNode) {
      elizaLogger.info('[WakuBase] stopping node...');
      await this.wakuNode.stop();
    }
  }

  defaultIntentsTopic(): string {
    return this.wakuConfig.WAKU_CONTENT_TOPIC.replace('PLACEHOLDER', this.wakuConfig.WAKU_TOPIC);
  }

  buildFullTopic(topic?: string): string {
    if (!topic) {
      return this.defaultIntentsTopic()
    } else if (topic.includes('random')) {
      // Optionally append random if you want ephemeral uniqueness
      return this.wakuConfig.WAKU_CONTENT_TOPIC.replace('PLACEHOLDER', randomHexString(16));
    } else if (!topic.startsWith('/')) { // partial topic
      return this.wakuConfig.WAKU_CONTENT_TOPIC.replace('PLACEHOLDER', topic);
    }

    return topic;
  }
}
