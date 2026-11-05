export type EmojiCategoryId = 'all' | 'smileys' | 'gestures' | 'hearts' | 'things';
export interface PickerEmoji { value: string; label: string; keywords: string }
export interface EmojiGroup { id: Exclude<EmojiCategoryId, 'all'>; label: string; emojis: PickerEmoji[] }

function group(id: EmojiGroup['id'], label: string, data: string): EmojiGroup {
  return { id, label, emojis: data.trim().split('\n').map((line) => {
    const [value, name, keywords = ''] = line.trim().split('|');
    return { value, label: name, keywords };
  }) };
}

/** Names double as accessible labels; aliases make ordinary words useful in search. */
export const EMOJI_GROUPS: EmojiGroup[] = [
  group('smileys', 'Smileys', `
😀|Grinning face|happy smile
😃|Smiling face with big eyes|happy grin
😄|Smiling face with smiling eyes|happy grin
😁|Beaming face|happy grin teeth
😆|Laughing face|happy laugh
😅|Smiling face with sweat|nervous relief
😂|Face with tears of joy|laugh lol crying
🤣|Rolling on the floor laughing|laugh lol rofl
😊|Blushing smile|happy shy
😇|Smiling face with halo|angel innocent
🙂|Slightly smiling face|happy smile
😉|Winking face|wink
😍|Heart eyes|love crush
🥰|Smiling face with hearts|love affectionate
😘|Blowing a kiss|love kiss
😗|Kissing face|love kiss
😋|Savoring food|yum tongue
😜|Winking face with tongue|playful silly
🤪|Zany face|crazy silly
🤨|Raised eyebrow|skeptical suspicious
🧐|Face with monocle|curious inspect
🤓|Nerd face|glasses geek
😎|Sunglasses face|cool sunny
🥳|Partying face|party celebration birthday
😏|Smirking face|flirt smug
😒|Unamused face|annoyed bored
😞|Disappointed face|sad
😔|Pensive face|sad thoughtful
😟|Worried face|anxious sad
😕|Confused face|unsure
🙁|Slightly frowning face|sad
😣|Persevering face|struggle
😖|Confounded face|frustrated
😫|Tired face|exhausted
😩|Weary face|tired exhausted
🥺|Pleading face|please puppy eyes
😢|Crying face|sad tears
😭|Loudly crying face|sad tears sob
😤|Face with steam from nose|angry frustrated
😠|Angry face|mad
😡|Pouting face|angry mad rage
🤬|Face with symbols on mouth|angry swear
🤯|Exploding head|mind blown shocked
😳|Flushed face|embarrassed shocked
🥵|Hot face|heat sweating
🥶|Cold face|freezing winter
😱|Screaming in fear|scared shocked
😨|Fearful face|scared
😰|Anxious face with sweat|nervous scared
😥|Sad but relieved face|disappointed
😓|Downcast face with sweat|nervous sad
🤗|Hugging face|hug care
🤔|Thinking face|think hmm
🤭|Face with hand over mouth|oops giggle
🤫|Shushing face|quiet secret
🤥|Lying face|lie pinocchio
😶|Face without mouth|silent speechless
😐|Neutral face|blank
😑|Expressionless face|blank bored
😬|Grimacing face|awkward nervous
🙄|Rolling eyes|annoyed eye roll
😯|Hushed face|surprised
😴|Sleeping face|sleep tired
🤤|Drooling face|yum desire
😪|Sleepy face|sleep tired
😵|Dizzy face|dizzy faint
🤐|Zipper mouth|quiet secret
🥴|Woozy face|dizzy drunk
🤢|Nauseated face|sick ill
🤮|Vomiting face|sick ill
🤧|Sneezing face|sick cold
😷|Face with medical mask|sick health
🤒|Face with thermometer|sick fever
🤕|Face with bandage|hurt injury
🤑|Money mouth|rich money
🤠|Cowboy face|hat western
😈|Smiling face with horns|devil mischievous
👿|Angry face with horns|devil angry
👻|Ghost|spooky halloween
💀|Skull|dead spooky halloween
👽|Alien|space
🤖|Robot|bot
💩|Pile of poo|poop
`),
  group('gestures', 'Gestures', `
👍|Thumbs up|yes good like okay
👎|Thumbs down|no dislike
👌|OK hand|okay perfect
✌️|Victory hand|peace two
🤞|Crossed fingers|luck hope
🤟|Love you gesture|love
🤘|Sign of the horns|rock
🤙|Call me hand|phone
👈|Pointing left|hand finger
👉|Pointing right|hand finger
👆|Pointing up|hand finger
👇|Pointing down|hand finger
☝️|Index pointing up|one finger
✋|Raised hand|stop high five
🤚|Raised back of hand|stop
🖐️|Hand with fingers spread|five
🖖|Vulcan salute|live long prosper
👋|Waving hand|hello hi bye goodbye
🤝|Handshake|agreement deal
🙏|Folded hands|please thanks pray
✊|Raised fist|solidarity
👊|Oncoming fist|punch bump
🤛|Left facing fist|bump
🤜|Right facing fist|bump
👏|Clapping hands|applause bravo
🙌|Raising hands|celebrate hooray
👐|Open hands|welcome
🤲|Palms up together|offer
💪|Flexed biceps|strong muscle
🦾|Mechanical arm|strong prosthetic
🖕|Middle finger|rude
✍️|Writing hand|write pen
🫰|Finger heart|love money
🫱|Rightwards hand|reach
🫲|Leftwards hand|reach
🫳|Palm down hand|drop
🫴|Palm up hand|offer
`),
  group('hearts', 'Hearts', `
❤️|Red heart|love
🧡|Orange heart|love
💛|Yellow heart|love
💚|Green heart|love
💙|Blue heart|love
💜|Purple heart|love
🖤|Black heart|love
🤍|White heart|love
🤎|Brown heart|love
💔|Broken heart|sad heartbreak
❣️|Heart exclamation|love
💕|Two hearts|love
💞|Revolving hearts|love
💓|Beating heart|love
💗|Growing heart|love
💖|Sparkling heart|love sparkle
💘|Heart with arrow|love cupid
💝|Heart with ribbon|love gift
💟|Heart decoration|love
♥️|Heart suit|love cards
💯|Hundred points|perfect score
💢|Anger symbol|angry
💥|Collision|boom explosion
💫|Dizzy star|sparkle
💦|Sweat droplets|water
💨|Dashing away|fast wind
🕳️|Hole|empty
💬|Speech balloon|chat talk
💭|Thought balloon|think dream
`),
  group('things', 'Things', `
🎉|Party popper|celebrate birthday
🎊|Confetti ball|party celebrate
🎈|Balloon|party birthday
🎁|Wrapped gift|present birthday
🎀|Ribbon|bow
🍀|Four leaf clover|luck
🌸|Cherry blossom|flower spring
🌺|Hibiscus|flower
🌻|Sunflower|flower
🌹|Rose|flower love
🥀|Wilted flower|rose sad
🌷|Tulip|flower spring
🌱|Seedling|plant grow
🌿|Herb|plant leaf
🍁|Maple leaf|autumn fall
🍂|Fallen leaf|autumn fall
🍃|Leaf in wind|plant
🌞|Sun with face|sunny weather
🌝|Full moon with face|night
🌚|New moon face|night
⭐|Star|favorite
🌟|Glowing star|sparkle
✨|Sparkles|magic shine
⚡|High voltage|lightning electric
🔥|Fire|hot flame
💧|Droplet|water rain
🌈|Rainbow|weather colors
☀️|Sun|sunny weather
⛅|Sun behind cloud|weather
🌧️|Rain cloud|rainy weather
⛈️|Thunderstorm|rain lightning weather
❄️|Snowflake|winter cold
☃️|Snowman|winter snow
🌊|Water wave|ocean sea
🍕|Pizza|food
🍔|Hamburger|food burger
🍟|French fries|food potato
🌮|Taco|food
🍣|Sushi|food
🍜|Steaming bowl|food noodles ramen
🍰|Shortcake|food dessert cake
🧁|Cupcake|food dessert cake
🍫|Chocolate bar|food dessert sweet
🍩|Doughnut|food dessert donut
☕|Hot beverage|coffee tea drink
🍵|Teacup|tea drink
🍺|Beer mug|drink
🍷|Wine glass|drink
🥂|Clinking glasses|drink cheers celebration
🎮|Video game|gaming controller
🎧|Headphones|music audio
🎵|Musical note|music
🎶|Musical notes|music
📱|Mobile phone|smartphone
💻|Laptop|computer
⌚|Watch|time clock
📷|Camera|photo picture
🎬|Clapper board|movie film
🚗|Car|travel drive
✈️|Airplane|travel flight
🏠|House|home
🏫|School|building
🏥|Hospital|health building
🏦|Bank|money building
🛒|Shopping cart|shop groceries
🎡|Ferris wheel|amusement park
🎢|Roller coaster|amusement park
🗽|Statue of Liberty|new york travel
⛰️|Mountain|nature travel
🏖️|Beach with umbrella|holiday travel
🌃|Night with stars|city night
🌆|Cityscape at dusk|city evening
🌇|Sunset|city evening
🌉|Bridge at night|city travel
🎆|Fireworks|celebration
🎇|Sparkler|celebration
🕯️|Candle|light
🔮|Crystal ball|magic fortune
🧸|Teddy bear|toy hug
🪄|Magic wand|magic
🪅|Piñata|party
`),
];

function searchKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\uFE0F/g, '').replace(/[:_]/g, ' ').trim();
}

export function filterEmojiGroups(query: string, category: EmojiCategoryId = 'all'): EmojiGroup[] {
  const words = searchKey(query).split(/\s+/).filter(Boolean);
  return EMOJI_GROUPS.filter((entry) => category === 'all' || entry.id === category).map((entry) => ({
    ...entry,
    emojis: entry.emojis.filter((emoji) => {
      const haystack = searchKey(`${emoji.value} ${emoji.label} ${emoji.keywords} ${entry.label}`);
      return words.every((word) => haystack.includes(word));
    }),
  })).filter((entry) => entry.emojis.length > 0);
}
