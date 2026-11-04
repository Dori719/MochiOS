export const DEFAULT_GROUP_CHAT_GUIDE = `# Group chat can be characters chatting with the user, or characters chatting with each other
# Prohibited from sending messages on behalf of the user
# Supported message types in group chat (only supports text/image/sticker/imgdesc/file/quote)
# Messages sent by group members
- t: text           # Text message
  c: {{Message content}}
  time: {{Time}}
  sender:
    name: {{Sender's name}}
- t: image          # Image message
  c: {{Image name, find in character image library}}
  time: {{Time}}
  sender:
    name: {{Sender's name}}
- t: sticker        # Sticker message
  c: {{Sticker name, must be found in sticker library}}
  time: {{Time}}
  sender:
    name: {{Sender's name}}
- t: imgdesc        # Text image description (used when no actual image available)
  c: {{Image content text description}}
  time: {{Time}}
  sender:
    name: {{Sender's name}}
- t: quote          # Quote message (reply/forward quote)
  quote:            # Quoted message information
    name: {{Quoted person's name/screen name}}
    t: text|image|sticker|imgdesc|voice|file|link|...  # Quoted message type
    c: {{Quoted message content (consistent with corresponding type's content)}}
  c: {{Own message content (same as text)}}
  time: {{Time}}
  sender:
    name: {{Sender's name}}
- t: file           # File message (supports pdf,docx,pptx,xlsx)
  name: {{Filename.extension}}
  size: {{File size, example: 2.5MB}}
  desc: {{File description}}
  time: {{Time}}
  sender:
    name: {{Sender's name}}
- t: transfer       # Transfer message
  amt: {{Amount, example: 520.00}}
  note: "{{Transfer note, optional}}"
  time: {{Time}}
    name: {{Sender's name}}

# Only allowed to generate messages sent by other group members, generating my messages is prohibited
# Output format:
<groupchat_history target="{{groupchatname}}">
date: {{Current date}}
time: {{Current time}}
members: {{Number of group members}}
messages:
  - t: text
    c: {{Message content}}
    time: {{Time}}
    sender:
      name: {{Sender's name}}
  - t: quote
    quote:
      name: {{Quoted person's name/screen name}}
      t: text|image|sticker|imgdesc|voice|file|link|...
      c: {{Quoted message content}}
    c: {{Own message content}}
    time: {{Time}}
    sender:
      name: {{Sender's name}}
  - t: image
    c: {{Image name, find in character image library}}
    time: {{Time}}
    sender:
      name: {{Sender's name}}
  - t: file
    name: {{Filename.extension}}
    size: {{File size}}
    desc: {{File description}}
    time: {{Time}}
    sender:
      name: {{Sender's name}}
</groupchat_history>`;
