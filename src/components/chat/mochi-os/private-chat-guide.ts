export const PRIVATE_READ_RECEIPT_RULES = `
# Private-chat read receipts
# Always generate userRead: false on every incoming message, including system messages.
# Mochi changes this field to true when the user actually views the message.
# Do not decide whether the user has read a message or generate userRead: true.
# Example (use spaces, never tabs, for YAML indentation):
# messages:
#   - t: text
#     c: "Hello"
#     time: "10:43"
#     userRead: false
`;

export const DEFAULT_GENERAL_PRIVATE_CHAT_GUIDE = `# Regular chat typically only uses text and stickers, other message types are only used in specific situations
# Daily chat primarily uses short sentences, with stickers interspersed appropriately, matching online chat habits
# Private chats between user and different characters are not shared; one character won't know the private chat content between other characters and the user

# Messages sent by the other party
- t: text           # Text message
  c: {{Message content}}
  time: {{Time}}
  userRead: false

# Private-chat read receipts
# Always generate userRead: false on every incoming message, including system messages.
# Do not decide whether the user has read a message or generate userRead: true.
# Example (use spaces, never tabs, for YAML indentation):

# Quote message (reply/forward quote)
- t: quote
  quote:
    name: {{Quoted person's name/screen name}}
    t: text|image|sticker|imgdesc|voice|file|link|...  # Quoted message type
    c: {{Quoted message content (consistent with corresponding type's content)}}
  c: {{Own message content (same as text)}}
  time: {{Time}}
  userRead: false

- t: sticker        # Sticker message
  c: {{Sticker name, must be found in sticker library}}
  time: {{Time}}
  userRead: false
- t: link           # Link message
  title: {{Link title}}
  source: {{Link source website}}
  preview: {{Content preview, about 20 words}}
  url: {{Link URL}}
  time: {{Time}}
  userRead: false
- t: voice          # Voice message
  c: {{Voice-to-text content}}
  audio: {{Audio file link}}
  time: {{Time}}
  userRead: false
- t: transfer       # Transfer message
  amt: {{Amount, example: $520.00}}
  note: "{{Transfer note, optional}}"
  time: {{Time}}
  userRead: false
- t: news           # News message
  title: {{News title}}
  source: {{Source}}
  publishDate: {{Publish date}}
  views: {{View count}}
  content: {{Content summary}}
  keyData: {{Key data}}
  likes: {{Like count}}
  comments: {{Comment count}}
  time: {{Time}}
  userRead: false
- t: location       # Location message
  myLoc: {{My location}}
  partnerLoc: {{Partner's location}}
  dist: {{Distance between both parties, example: 200m}}
  time: {{Time}}
  userRead: false
- t: file           # File message (supports pdf,docx,pptx,xlsx)
  name: {{Filename.extension}}
  size: {{File size, example: 2.5MB}}
  desc: {{File description}}
  time: {{Time}}
  userRead: false

# Can be sent when the character wants to listen to music together
- t: listen-together  # Listen to music together invitation
  time: {{Time}}
  userRead: false

# System messages
# Transfer system messages are only used after the user sends a transfer, to decide whether to accept; prohibited in other cases such as sending transfers yourself
- t: transfer-accepted  # Accept transfer message
  amt: {{Amount, example: $520.00}}
  time: "{{Time}}"
- t: transfer-rejected  # Reject transfer message
  amt: {{Amount, example: $520.00}}
  time: {{Time}}
  userRead: false

# Listen-together system messages are only used after the user sends a listen-together invitation, to decide whether to accept; prohibited in other cases such as sending listen-together yourself
- t: listen-accepted  # Accept listen-together (system message, centered display)
  time: {{Time}}
  userRead: false
- t: listen-rejected  # Reject listen-together (system message, centered display)
  time: {{Time}}
  userRead: false

# Only generate messages sent by the other party, generating my messages is prohibited, any of my messages are not allowed
# Output format:
<privatechat_history target="{{Other party's name}}" type="private">
date: {{Date}}
time: {{Time}}
messages:
  - t: text
    c: {{Message content}}
    time: {{Time}}
    userRead: false
  - t: sticker
    c: {{Sticker name}}
    time: {{Time}}
    userRead: false
# ...multiple message types can appear
</privatechat_history>`;
