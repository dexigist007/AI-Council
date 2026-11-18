from gtts import gTTS
L=["Nouveau livreur ?","Écoute bien.","Et si chaque course te rapportait plus que tu ne l'imagines ?","Tes horaires. Ta ville. Tes règles.","Quelque chose arrive. Reste connecté."]
for i,t in enumerate(L): gTTS(t,lang='fr').save(f'vo/{i}.mp3')
