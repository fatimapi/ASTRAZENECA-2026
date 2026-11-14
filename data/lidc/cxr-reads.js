// Chest X-ray classifier results with AI summaries (research only). Made by summarise_cxr.py.
window.candexCxrReads = {
 "schema": 1,
 "provenance": {
  "classifier": "TorchXRayVision DenseNet121 1.5.7 (densenet121-res224-all), Candex backend",
  "summaryModel": "gemini-3.5-flash",
  "generated": "2026-11-14",
  "input": "One frontal chest X-ray per patient (LIDC-IDRI research test copy; ViewPosition inferred from headers)",
  "method": "Gemini summary of the raw scores, then an independent Gemini safety review against the raw data (one redraft if issues are found)",
  "disclaimer": "Research only. Scores are uncalibrated (not probabilities), no threshold, not a diagnosis; this classifier is not a nodule detector."
 },
 "cases": {
  "LIDC-IDRI-0002": {
   "view": "PA",
   "viewEvidence": "SID 1.80 m",
   "viewNote": "",
   "scores": [
    {
     "label": "Lung Opacity",
     "score": 0.4962
    },
    {
     "label": "Atelectasis",
     "score": 0.3014
    },
    {
     "label": "Effusion",
     "score": 0.1623
    },
    {
     "label": "Fracture",
     "score": 0.1482
    },
    {
     "label": "Consolidation",
     "score": 0.1413
    },
    {
     "label": "Pneumonia",
     "score": 0.1339
    },
    {
     "label": "Cardiomegaly",
     "score": 0.1229
    },
    {
     "label": "Infiltration",
     "score": 0.1189
    },
    {
     "label": "Nodule",
     "score": 0.1013
    },
    {
     "label": "Lung Lesion",
     "score": 0.0687
    },
    {
     "label": "Pneumothorax",
     "score": 0.0475
    },
    {
     "label": "Emphysema",
     "score": 0.038
    },
    {
     "label": "Enlarged Cardiomediastinum",
     "score": 0.0346
    },
    {
     "label": "Mass",
     "score": 0.0264
    },
    {
     "label": "Fibrosis",
     "score": 0.0217
    },
    {
     "label": "Hernia",
     "score": 0.0215
    },
    {
     "label": "Edema",
     "score": 0.0207
    },
    {
     "label": "Pleural_Thickening",
     "score": 0.0059
    }
   ],
   "nodule": 0.1013,
   "mass": 0.0264,
   "image": "data/lidc/LIDC-IDRI-0002/cxr.jpg",
   "summary": {
    "en": "For anonymised research patient LIDC-IDRI-0002 (PA view, no view note provided), the research prototype model yielded highest scores for Lung Opacity (0.50) and Atelectasis (0.30), while Nodule was 0.10 and Mass was 0.03. The scores are uncalibrated model outputs from 0 to 1: NOT probabilities, NOT a diagnosis, and no decision threshold has been applied. The CT reference notes 1 nodule marked by radiologists measuring 30.8 mm (approx Lung-RADS 4B). This classifier is not a nodule detector, and because X-ray and CT dates are unknown, a nodule seen on CT may not have been visible on the X-ray.",
    "fi": "Anonymisoidun tutkimustapauksen LIDC-IDRI-0002 PA-kuvasta (ei erillistä näkymähuomautusta) tutkimusprototyyppimalli antoi korkeimmat pisteet keuhkosumennumalle (Lung Opacity 0.50) ja atelektaasille (0.30), kun taas Nodule oli 0.10 ja Mass 0.03. Pistemäärät ovat kalibroimattomia mallin ulostuloja välillä 0–1: eivät todennäköisyyksiä, eivät diagnoosi, eikä päätöskynnystä ole käytetty. CT-referenssissä on 1 radiologin merkitsemä nodulus (30.8 mm, approx Lung-RADS 4B). Luokittelija ei ole nodulustetektori, ja koska keuhkokuvan ja CT:n päivämääriä ei tiedetä, CT:ssä näkyvä nodulus ei välttämättä ole ollut näkyvissä keuhkokuvassa."
   },
   "keyPoints": {
    "en": [
     "Anonymised research case LIDC-IDRI-0002 evaluated using a research prototype (PA view): Lung Opacity 0.50, Atelectasis 0.30, Nodule 0.10, Mass 0.03.",
     "Scores are uncalibrated model outputs from 0 to 1: NOT probabilities, NOT a diagnosis, no decision threshold.",
     "CT reference indicates 1 nodule (30.8 mm, approx Lung-RADS 4B); the classifier is not a nodule detector and scan dates are unknown, so a nodule seen on CT may not have been visible on X-ray."
    ],
    "fi": [
     "Anonymisoitu tutkimustapaus LIDC-IDRI-0002 arvioitu tutkimusprototyypillä (PA-näkymä): Lung Opacity 0.50, Atelectasis 0.30, Nodule 0.10, Mass 0.03.",
     "Pistemäärät ovat kalibroimattomia mallin ulostuloja välillä 0–1: eivät todennäköisyyksiä, eivät diagnoosi, eikä päätöskynnystä ole käytetty.",
     "CT-referenssissä 1 nodulus (30.8 mm, approx Lung-RADS 4B); malli ei ole nodulustetektori ja kuvantamisajankohdat ovat tuntemattomat, joten CT:ssä näkyvä nodulus ei välttämättä ole näkynyt keuhkokuvassa."
    ]
   },
   "review": {
    "verdict": "consistent with the raw data",
    "issues": [],
    "attempts": 1
   }
  },
  "LIDC-IDRI-0029": {
   "view": "PA",
   "viewEvidence": "SID 1.83 m",
   "viewNote": "",
   "scores": [
    {
     "label": "Lung Opacity",
     "score": 0.2152
    },
    {
     "label": "Infiltration",
     "score": 0.1154
    },
    {
     "label": "Pleural_Thickening",
     "score": 0.0608
    },
    {
     "label": "Mass",
     "score": 0.0474
    },
    {
     "label": "Effusion",
     "score": 0.0358
    },
    {
     "label": "Fibrosis",
     "score": 0.0346
    },
    {
     "label": "Fracture",
     "score": 0.0312
    },
    {
     "label": "Atelectasis",
     "score": 0.0292
    },
    {
     "label": "Nodule",
     "score": 0.0278
    },
    {
     "label": "Pneumothorax",
     "score": 0.0132
    },
    {
     "label": "Enlarged Cardiomediastinum",
     "score": 0.0124
    },
    {
     "label": "Consolidation",
     "score": 0.0107
    },
    {
     "label": "Cardiomegaly",
     "score": 0.005
    },
    {
     "label": "Hernia",
     "score": 0.0042
    },
    {
     "label": "Emphysema",
     "score": 0.0019
    },
    {
     "label": "Lung Lesion",
     "score": 0.0005
    },
    {
     "label": "Pneumonia",
     "score": 0.0002
    },
    {
     "label": "Edema",
     "score": 0.0001
    }
   ],
   "nodule": 0.0278,
   "mass": 0.0474,
   "image": "data/lidc/LIDC-IDRI-0029/cxr.jpg",
   "summary": {
    "en": "This summary evaluates a PA chest X-ray for anonymized research patient LIDC-IDRI-0029 using the TorchXRayVision DenseNet121 research prototype classifier. Model outputs are uncalibrated scores between 0 and 1, not disease probabilities or a diagnosis, and no decision threshold is applied. The classifier output scores were 0.03 for Nodule, 0.05 for Mass, and 0.22 for Lung Opacity. While the CT reference identified 1 radiologist-marked nodule measuring 31.5 mm (approximate Lung-RADS 4X-like), this classifier is not a dedicated nodule detector and scan dates are unknown, meaning a CT finding may not have been visible on the X-ray.",
    "fi": "Tämä yhteenveto arvioi anonymisoidun tutkimuspotilaan LIDC-IDRI-0029 PA-keuhkoröntgenkuvaa TorchXRayVision DenseNet121 -tutkimusprototyypillä. Mallin tulokset ovat kalibroimattomia pistemääriä välillä 0–1, eivät sairauden todennäköisyyksiä tai diagnoosi, eikä päätöskynnystä sovelleta. Luokittelija antoi pistemääriksi 0,03 osiolle Nodule, 0,05 osiolle Mass ja 0,22 osiolle Lung Opacity. Vaikka CT-viitetiedoissa havaittiin yksi radiologin merkitsemä 31,5 mm:n kyhmy (noin Lung-RADS 4X -luokkaa), tämä luokittelija ei ole kyhmyjen ilmaisin ja kuvauspäivät ovat tuntemattomat, joten CT-löydös ei välttämättä ollut näkyvissä röntgenkuvassa."
   },
   "keyPoints": {
    "en": [
     "Research prototype evaluation for anonymized patient LIDC-IDRI-0029 (PA view) with uncalibrated scores from 0 to 1, not probabilities or diagnoses.",
     "X-ray classifier scores were 0.03 for Nodule, 0.05 for Mass, and 0.22 for Lung Opacity.",
     "CT reference standard identified 1 nodule measuring 31.5 mm (Lung-RADS 4X-like).",
     "The model is not a nodule detector and scan dates are unknown, so CT nodules may not be visible on the chest X-ray."
    ],
    "fi": [
     "Tutkimusprototyypin arvio anonymisoidusta potilaasta LIDC-IDRI-0029 (PA-kuva); tulokset ovat kalibroimattomia pisteitä välillä 0–1, eivät todennäköisyyksiä tai diagnooseja.",
     "Röntgenluokittelijan pisteet olivat Nodule 0,03, Mass 0,05 ja Lung Opacity 0,22.",
     "CT-viitteessä todettiin 1 radiologin merkitsemä kyhmy (koko 31,5 mm, Lung-RADS 4X-tyyppinen).",
     "Malli ei ole kyhmyjen ilmaisin ja kuvauspäivät ovat tuntemattomat, joten CT-kyhmy ei välttämättä näkynyt röntgenkuvassa."
    ]
   },
   "review": {
    "verdict": "consistent with the raw data",
    "issues": [],
    "attempts": 1
   }
  },
  "LIDC-IDRI-0051": {
   "view": "PA",
   "viewEvidence": "SID 1.80 m",
   "viewNote": "Stored display window -600/1600 clipped 99.5% of pixels; removed so the image is scaled over its stored range.",
   "scores": [
    {
     "label": "Cardiomegaly",
     "score": 0.4506
    },
    {
     "label": "Infiltration",
     "score": 0.0908
    },
    {
     "label": "Mass",
     "score": 0.0614
    },
    {
     "label": "Atelectasis",
     "score": 0.0419
    },
    {
     "label": "Enlarged Cardiomediastinum",
     "score": 0.0381
    },
    {
     "label": "Lung Opacity",
     "score": 0.0366
    },
    {
     "label": "Nodule",
     "score": 0.0272
    },
    {
     "label": "Effusion",
     "score": 0.0268
    },
    {
     "label": "Pleural_Thickening",
     "score": 0.0212
    },
    {
     "label": "Fracture",
     "score": 0.0192
    },
    {
     "label": "Hernia",
     "score": 0.0156
    },
    {
     "label": "Consolidation",
     "score": 0.0098
    },
    {
     "label": "Fibrosis",
     "score": 0.0075
    },
    {
     "label": "Emphysema",
     "score": 0.0066
    },
    {
     "label": "Pneumonia",
     "score": 0.0028
    },
    {
     "label": "Pneumothorax",
     "score": 0.0014
    },
    {
     "label": "Lung Lesion",
     "score": 0.0013
    },
    {
     "label": "Edema",
     "score": 0.0012
    }
   ],
   "nodule": 0.0272,
   "mass": 0.0614,
   "image": "data/lidc/LIDC-IDRI-0051/cxr.jpg",
   "summary": {
    "en": "For anonymised research patient LIDC-IDRI-0051, a PA chest X-ray was evaluated using the TorchXRayVision DenseNet121 model after removing a stored display window (-600/1600 clipped 99.5% of pixels) to scale over the stored range. The classifier output low scores for Nodule (0.03) and Mass (0.06), with Cardiomegaly receiving the highest score at 0.45; these scores are uncalibrated model outputs from 0 to 1, NOT probabilities, NOT a diagnosis, and no decision threshold is applied. In contrast, the CT reference documented 3 nodules including a 15.3 mm main nodule (Lung-RADS 4B), though this classifier is not a dedicated nodule detector and scan dates are unknown, so a nodule on CT may not have been visible on X-ray. This research prototype summary does not diagnose or recommend treatment and requires review by a qualified clinician.",
    "fi": "Anonymisoidun tutkimuspotilaan LIDC-IDRI-0051 PA-keuhkokuvasta saatiin TorchXRayVision DenseNet121 -mallilla matalat pisteet luokille Nodule (0.03) ja Mass (0.06), ja korkein piste oli Cardiomegaly (0.45). Kuvan tallennettu katseluikkuna (-600/1600 leikkasi 99.5% pikseleistä) poistettiin skaalauksen korjaamiseksi. Tulospisteet ovat kalibroimattomia mallin ulostuloja asteikolla 0–1, EIVÄT todennäköisyyksiä EIKÄ diagnoosi, eikä päätöskynnystä ole käytetty. TT-vertailutiedossa todettiin 3 nodulusta (päänodulus 15.3 mm, Lung-RADS 4B), mutta luokittelija ei ole nodulusilmaisin ja kuvien ajankohdat ovat tuntemattomat, joten TT-nodulus ei välttämättä erottunut röntgenkuvassa."
   },
   "keyPoints": {
    "en": [
     "Classifier scores were Nodule 0.03, Mass 0.06, and Cardiomegaly 0.45 on a PA X-ray.",
     "CT reference identified 3 nodules including a 15.3 mm main nodule (Lung-RADS 4B).",
     "Scores are uncalibrated model outputs from 0 to 1, not probabilities or diagnoses; X-ray and CT dates are unknown.",
     "Image processing note: Stored display window -600/1600 clipped 99.5% of pixels and was removed for full-range scaling on this research prototype."
    ],
    "fi": [
     "Luokittelijan pisteet olivat Nodule 0.03, Mass 0.06 ja Cardiomegaly 0.45 PA-röntgenkuvassa.",
     "Vertailu-TT osoitti 3 nodulusta, mukaan lukien 15.3 mm päänoduluksen (Lung-RADS 4B).",
     "Pisteet ovat kalibroimattomia mallin ulostuloja välillä 0–1, eivät todennäköisyyksiä tai diagnooseja; kuvantamisajankohdat ovat tuntemattomat.",
     "Kuvan huomautus: Tallennettu katseluikkuna -600/1600 leikkasi 99.5% pikseleistä ja poistettiin tässä tutkimusprototyypissä."
    ]
   },
   "review": {
    "verdict": "consistent with the raw data",
    "issues": [],
    "attempts": 1
   }
  },
  "LIDC-IDRI-0052": {
   "view": "PA",
   "viewEvidence": "SID 1.80 m",
   "viewNote": "",
   "scores": [
    {
     "label": "Infiltration",
     "score": 0.1722
    },
    {
     "label": "Atelectasis",
     "score": 0.0793
    },
    {
     "label": "Pleural_Thickening",
     "score": 0.0415
    },
    {
     "label": "Lung Opacity",
     "score": 0.0359
    },
    {
     "label": "Fracture",
     "score": 0.0354
    },
    {
     "label": "Nodule",
     "score": 0.0302
    },
    {
     "label": "Effusion",
     "score": 0.0182
    },
    {
     "label": "Hernia",
     "score": 0.0177
    },
    {
     "label": "Consolidation",
     "score": 0.0144
    },
    {
     "label": "Fibrosis",
     "score": 0.0142
    },
    {
     "label": "Mass",
     "score": 0.0126
    },
    {
     "label": "Enlarged Cardiomediastinum",
     "score": 0.0059
    },
    {
     "label": "Pneumonia",
     "score": 0.0056
    },
    {
     "label": "Pneumothorax",
     "score": 0.0048
    },
    {
     "label": "Lung Lesion",
     "score": 0.0018
    },
    {
     "label": "Cardiomegaly",
     "score": 0.001
    },
    {
     "label": "Emphysema",
     "score": 0.0009
    },
    {
     "label": "Edema",
     "score": 0.0002
    }
   ],
   "nodule": 0.0302,
   "mass": 0.0126,
   "image": "data/lidc/LIDC-IDRI-0052/cxr.jpg",
   "summary": {
    "en": "For anonymised research patient LIDC-IDRI-0052, the TorchXRayVision DenseNet121 model analyzed a PA view chest X-ray and assigned low scores of 0.03 for Nodule and 0.01 for Mass, with the highest score being 0.17 for Infiltration. These scores are uncalibrated model outputs from 0 to 1, not disease probabilities or a diagnosis, and no decision threshold is applied. Although the CT reference recorded 2 radiologist-marked nodules including a 28.8 mm lesion (approximate Lung-RADS 4X-like), this X-ray classifier is not a dedicated nodule detector, and scan dates are unknown so the CT finding may not have been visible on the X-ray. This research prototype output requires qualified clinical review and does not constitute a diagnosis or treatment recommendation.",
    "fi": "Anonymisoidun tutkimuspotilaan LIDC-IDRI-0052 PA-suunnan keuhkoröntgenkuvasta TorchXRayVision DenseNet121 -malli antoi matalat pisteet luokille Nodule (0.03) ja Mass (0.01), korkeimman pistemäärän ollessa Infiltration (0.17). Nämä pisteet ovat kalibroimattomia mallin ulostuloja välillä 0–1, eivät todennäköisyyksiä tai diagnooseja, eikä päätöskynnystä ole käytetty. Vaikka CT-referenssiin kirjattiin kaksi radiologin merkitsemää kyhmyä mukaan lukien 28.8 mm kokoinen löydös (lähes Lung-RADS 4X -luokkaa), tämä röntgenluokittelija ei ole kyhmyilmaisin ja kuvauspäivät ovat tuntemattomia, joten CT-löydös ei välttämättä näkynyt röntgenkuvassa. Tämä tutkimusprototyypin tulos vaatii kliinisen asiantuntijan arvioinnin eikä toimi diagnoosina tai hoitosuosituksena."
   },
   "keyPoints": {
    "en": [
     "Research prototype analysis for anonymised patient LIDC-IDRI-0052 (PA view).",
     "Model scores are uncalibrated values (0 to 1): Infiltration 0.17, Nodule 0.03, Mass 0.01.",
     "CT reference indicates a 28.8 mm main nodule (Lung-RADS 4X-like) across 2 marked nodules; the X-ray classifier is not a nodule detector and scan dates are unknown."
    ],
    "fi": [
     "Tutkimusprototyypin analyysi anonymisoidulle potilaalle LIDC-IDRI-0052 (PA-kuva).",
     "Mallin pisteet ovat kalibroimattomia arvoja (0–1): Infiltration 0.17, Nodule 0.03, Mass 0.01.",
     "CT-referenssissä todettiin 28.8 mm päälöydös (Lung-RADS 4X -kaltainen) ja 2 merkittyä kyhmyä; röntgenluokittelija ei ole kyhmyilmaisin ja kuvausajankohdat ovat tuntemattomia."
    ]
   },
   "review": {
    "verdict": "consistent with the raw data",
    "issues": [],
    "attempts": 1
   }
  },
  "LIDC-IDRI-0116": {
   "view": "PA",
   "viewEvidence": "SID 1.80 m",
   "viewNote": "Pixel data is inverted relative to its MONOCHROME2 label (spine dark, lungs bright; mean spine 3986 vs lung 10409, the reverse of the other images). Relabelled MONOCHROME1.",
   "scores": [
    {
     "label": "Lung Opacity",
     "score": 0.1074
    },
    {
     "label": "Cardiomegaly",
     "score": 0.0914
    },
    {
     "label": "Infiltration",
     "score": 0.0743
    },
    {
     "label": "Pneumothorax",
     "score": 0.0667
    },
    {
     "label": "Atelectasis",
     "score": 0.0576
    },
    {
     "label": "Effusion",
     "score": 0.0559
    },
    {
     "label": "Enlarged Cardiomediastinum",
     "score": 0.0514
    },
    {
     "label": "Pneumonia",
     "score": 0.047
    },
    {
     "label": "Fracture",
     "score": 0.0423
    },
    {
     "label": "Lung Lesion",
     "score": 0.0268
    },
    {
     "label": "Mass",
     "score": 0.0227
    },
    {
     "label": "Emphysema",
     "score": 0.021
    },
    {
     "label": "Consolidation",
     "score": 0.0203
    },
    {
     "label": "Nodule",
     "score": 0.0129
    },
    {
     "label": "Edema",
     "score": 0.0115
    },
    {
     "label": "Hernia",
     "score": 0.0088
    },
    {
     "label": "Pleural_Thickening",
     "score": 0.0014
    },
    {
     "label": "Fibrosis",
     "score": 0.0009
    }
   ],
   "nodule": 0.0129,
   "mass": 0.0227,
   "image": "data/lidc/LIDC-IDRI-0116/cxr.jpg",
   "summary": {
    "en": "This chest X-ray evaluation for anonymised research case LIDC-IDRI-0116 (PA view) produced low model scores for Nodule (0.01) and Mass (0.02), with Lung Opacity yielding the highest output at 0.11. Note that these scores are uncalibrated model outputs from 0 to 1: they are NOT probabilities, NOT a diagnosis, and have no decision threshold applied. The CT reference documented 2 radiologists-marked nodules including a 27.6 mm main nodule (Lung-RADS 4X-like); however, this classifier is not a dedicated nodule detector and the acquisition dates are unknown, so a nodule seen on CT may not have been visible on the X-ray. Additionally, the X-ray pixel data was inverted relative to its DICOM MONOCHROME2 label and was relabelled MONOCHROME1.",
    "fi": "Tämä anonymisoidun tutkimustapauksen LIDC-IDRI-0116 keuhkokuvan (PA-näkymä) arviointi tuotti matalat mallipisteet luokille Nodule (0.01) ja Mass (0.02), korkeimman pistemäärän ollessa Lung Opacity (0.11). Huomaa, että nämä pisteet ovat kalibroimattomia mallin ulostuloja välillä 0–1: ne EIVÄT ole todennäköisyyksiä, EIVÄT diagnoosi, eikä mitään päätöskynnystä ole käytetty. CT-referenssissä todettiin 2 radiologin merkitsemää nodulusta, mukaan lukien 27.6 mm päänodulus (Lung-RADS 4X-kaltainen); tämä luokittelija ei kuitenkaan ole nodulustunnistin ja kuvauspäivät ovat tuntemattomat, joten CT:ssä näkyvä nodulus ei välttämättä ollut näkyvissä keuhkokuvassa. Lisäksi kuvan pikselitiedot olivat käänteiset MONOCHROME2-otsakkeeseen nähden ja ne merkittiin uudelleen MONOCHROME1-muotoon."
   },
   "keyPoints": {
    "en": [
     "Research prototype results for LIDC-IDRI-0116 (PA view): Nodule score is 0.01, Mass score is 0.02, and Lung Opacity score is 0.11.",
     "Scores are uncalibrated model outputs from 0 to 1, not disease probabilities, diagnoses, or decision thresholds.",
     "CT reference identified 2 nodules (main nodule 27.6 mm, Lung-RADS 4X-like); classifier is not a nodule detector and scan dates are unknown.",
     "Image processing note: Pixel data was inverted relative to MONOCHROME2 label and relabelled MONOCHROME1."
    ],
    "fi": [
     "Tutkimusprototyypin tulokset tapaukselle LIDC-IDRI-0116 (PA-kuva): Nodule-pisteet 0.01, Mass-pisteet 0.02 ja Lung Opacity -pisteet 0.11.",
     "Pisteet ovat kalibroimattomia mallin ulostuloja (0–1), eivät sairauden todennäköisyyksiä, diagnooseja tai päätöskynnyksiä.",
     "CT-referenssissä havaittiin 2 nodulusta (päänodulus 27.6 mm, Lung-RADS 4X-kaltainen); luokittelija ei ole nodulustunnistin ja kuvauspäivät ovat tuntemattomat.",
     "Kuvankäsittelyhuomautus: Pikselidata oli käänteinen MONOCHROME2-merkintään nähden ja se merkittiin uudelleen MONOCHROME1-muotoon."
    ]
   },
   "review": {
    "verdict": "consistent with the raw data",
    "issues": [],
    "attempts": 1
   }
  },
  "LIDC-IDRI-0170": {
   "view": "PA",
   "viewEvidence": "SID 1.80 m; description \"CHEST, PA & LATERAL CHEST, PA & LATERAL\"",
   "viewNote": "Monitoring leads and a line are visible, as in an inpatient; headers still indicate a standard PA set-up. View not confirmed visually.",
   "scores": [
    {
     "label": "Lung Opacity",
     "score": 0.5272
    },
    {
     "label": "Effusion",
     "score": 0.3078
    },
    {
     "label": "Infiltration",
     "score": 0.2982
    },
    {
     "label": "Atelectasis",
     "score": 0.1969
    },
    {
     "label": "Pneumonia",
     "score": 0.1923
    },
    {
     "label": "Pleural_Thickening",
     "score": 0.1582
    },
    {
     "label": "Enlarged Cardiomediastinum",
     "score": 0.1429
    },
    {
     "label": "Cardiomegaly",
     "score": 0.1209
    },
    {
     "label": "Mass",
     "score": 0.1186
    },
    {
     "label": "Consolidation",
     "score": 0.1114
    },
    {
     "label": "Nodule",
     "score": 0.0557
    },
    {
     "label": "Fibrosis",
     "score": 0.0506
    },
    {
     "label": "Edema",
     "score": 0.0506
    },
    {
     "label": "Fracture",
     "score": 0.0498
    },
    {
     "label": "Pneumothorax",
     "score": 0.0163
    },
    {
     "label": "Lung Lesion",
     "score": 0.0145
    },
    {
     "label": "Emphysema",
     "score": 0.0054
    },
    {
     "label": "Hernia",
     "score": 0.0026
    }
   ],
   "nodule": 0.0557,
   "mass": 0.1186,
   "image": "data/lidc/LIDC-IDRI-0170/cxr.jpg",
   "summary": {
    "en": "This evaluation of anonymised research case LIDC-IDRI-0170 using a research prototype classifier (TorchXRayVision DenseNet121) shows top outputs for Lung Opacity (0.53), Effusion (0.31), and Infiltration (0.30). The scores are uncalibrated model outputs from 0 to 1, not probabilities, not a diagnosis, and have no decision threshold applied. Although CT reference identified 2 nodules (main nodule 35.5 mm, approx. Lung-RADS 4B), the X-ray scores for Nodule (0.06) and Mass (0.12) were low; this classifier is not a nodule detector, and scan dates are unknown so a CT nodule may not have been visible on the X-ray. Image headers indicate a standard PA setup, but inpatient-style monitoring leads and a line are noted, and the view has not been visually confirmed.",
    "fi": "Tämä anonymisoidun tutkimustapauksen LIDC-IDRI-0170 arviointi tutkimusprototyyppiluokittelijalla (TorchXRayVision DenseNet121) antaa korkeimmat pisteet keuhkosamentumalle (0,53), neste-ertymälle (0,31) ja infiltraatiolle (0,30). Pisteet ovat kalibroimattomia mallin ulostuloja välillä 0–1, eivätkä ne ole todennäköisyyksiä, diagnooseja tai päätösrajoja. Vaikka CT-viitteessä todetaan 2 radiologin merkitsemää kyhmyä (pääkyhmy 35,5 mm, Lung-RADS 4B), röntgenkuvan Nodule-pisteet ovat 0,06 ja Mass-pisteet 0,12; luokittelija ei ole kyhmyilmaisin ja kuvauspäivät ovat tuntemattomat, joten CT-kyhmy ei välttämättä näkynyt röntgenkuvassa. Otsikkotiedot viittaavat PA-kuvaan, mutta kuvassa todetaan valvontalaitteiden johtoja ja linja (näkymää ei ole vahvistettu visuaalisesti)."
   },
   "keyPoints": {
    "en": [
     "Top scores are Lung Opacity (0.53), Effusion (0.31), and Infiltration (0.30); scores are uncalibrated model outputs from 0 to 1, not probabilities or diagnoses.",
     "CT reference reports 2 nodules (main nodule 35.5 mm, Lung-RADS 4B), whereas X-ray scores for Nodule (0.06) and Mass (0.12) are low, reflecting classifier limits and unlinked scan dates.",
     "Research prototype analysis for anonymised case LIDC-IDRI-0170; headers show a PA view but monitoring leads/lines are present and view is not visually confirmed."
    ],
    "fi": [
     "Korkeimmat pisteet ovat keuhkosamentuma (0,53), neste-ertymä (0,31) ja infiltraatio (0,30); pisteet ovat kalibroimattomia mallituloksia välillä 0–1, eivät todennäköisyyksiä tai diagnooseja.",
     "CT-viite raportoi 2 kyhmyä (pääkyhmy 35,5 mm, Lung-RADS 4B), kun taas röntgenin Nodule (0,06)- ja Mass (0,12) -pisteet ovat matalat johtuen mallin rajoitteista ja tuntemattomista kuvauspäivistä.",
     "Tutkimusprototyypin arviointi anonymisoidulle tapaukselle LIDC-IDRI-0170; otsakkeet osoittavat PA-näkymää, mutta valvontajohtoja/linjoja on havaittu eikä näkymää ole vahvistettu visuaalisesti."
    ]
   },
   "review": {
    "verdict": "consistent with the raw data",
    "issues": [],
    "attempts": 1
   }
  },
  "LIDC-IDRI-0233": {
   "view": "PA",
   "viewEvidence": "SID 1.80 m; description \"CHEST, PA & LATERAL CHEST, PA & LATERAL\"",
   "viewNote": "",
   "scores": [
    {
     "label": "Infiltration",
     "score": 0.1348
    },
    {
     "label": "Pleural_Thickening",
     "score": 0.0116
    },
    {
     "label": "Nodule",
     "score": 0.0115
    },
    {
     "label": "Fracture",
     "score": 0.0101
    },
    {
     "label": "Lung Opacity",
     "score": 0.0089
    },
    {
     "label": "Mass",
     "score": 0.006
    },
    {
     "label": "Fibrosis",
     "score": 0.0055
    },
    {
     "label": "Atelectasis",
     "score": 0.0054
    },
    {
     "label": "Enlarged Cardiomediastinum",
     "score": 0.0044
    },
    {
     "label": "Consolidation",
     "score": 0.0037
    },
    {
     "label": "Effusion",
     "score": 0.0032
    },
    {
     "label": "Pneumothorax",
     "score": 0.0029
    },
    {
     "label": "Lung Lesion",
     "score": 0.001
    },
    {
     "label": "Emphysema",
     "score": 0.0008
    },
    {
     "label": "Pneumonia",
     "score": 0.0007
    },
    {
     "label": "Cardiomegaly",
     "score": 0.0004
    },
    {
     "label": "Hernia",
     "score": 0.0001
    },
    {
     "label": "Edema",
     "score": 0.0001
    }
   ],
   "nodule": 0.0115,
   "mass": 0.006,
   "image": "data/lidc/LIDC-IDRI-0233/cxr.jpg",
   "summary": {
    "en": "This case involves anonymised research patient LIDC-IDRI-0233 evaluated with a research prototype (TorchXRayVision DenseNet121) on a PA chest X-ray. The classifier yielded scores of 0.01 for Nodule and 0.01 for Mass, with the highest score being Infiltration at 0.13; these are uncalibrated model outputs from 0 to 1, not disease probabilities or a diagnosis. Reference CT noted 2 nodules, including a 7.6 mm main nodule (approximate Lung-RADS 3). However, this classifier is not a dedicated nodule detector and scan dates are unknown, so CT findings may not have been visible on the X-ray.",
    "fi": "Tämä tapaus koskee anonymisoitua tutkimuspotilasta LIDC-IDRI-0233, jonka PA-keuhkoröntgenkuva arvioitiin tutkimusprototyypillä (TorchXRayVision DenseNet121). Luokittelija antoi pistemääräksi 0.01 kyhmylle (\"Nodule\") ja 0.01 massalle (\"Mass\"), ja korkein pistemäärä oli infiltraatiolle 0.13; nämä ovat kalibroimattomia mallin tuloksia välillä 0–1, eivät todennäköisyyksiä tai diagnooseja. Viite-CT-tutkimuksessa todettiin 2 kyhmyä, mukaan lukien 7.6 mm pääkyhmy (noin Lung-RADS 3). Tämä luokittelija ei kuitenkaan ole kyhmydentunnistin ja kuvauspäivät ovat tuntemattomat, joten CT:ssä nähdyt löydökset eivät välttämättä näkyneet röntgenkuvassa."
   },
   "keyPoints": {
    "en": [
     "Research prototype evaluation of a PA chest X-ray for anonymised patient LIDC-IDRI-0233.",
     "Scores for Nodule (0.01) and Mass (0.01) were low, with Infiltration at 0.13; scores are uncalibrated outputs from 0 to 1, not probabilities or diagnoses.",
     "CT reference showed 2 nodules (main nodule 7.6 mm, Lung-RADS 3), but scan dates are unknown and the model is not a nodule detector, so CT findings may not be visible on X-ray."
    ],
    "fi": [
     "Tutkimusprototyypin arviointi anonymisoidun potilaan LIDC-IDRI-0233 PA-keuhkoröntgenkuvasta.",
     "Kyhmyn (0.01) ja massan (0.01) pistemäärät olivat matalia (korkein Infiltration 0.13); tulokset ovat kalibroimattomia mallin arvoja 0–1, eivät todennäköisyyksiä tai diagnooseja.",
     "CT-viitteessä näkyi 2 kyhmyä (pääkyhmy 7.6 mm, Lung-RADS 3), mutta kuvauspäiviä ei tiedetä eikä malli ole kyhmydentunnistin, joten ne eivät välttämättä näkyneet röntgenkuvassa."
    ]
   },
   "review": {
    "verdict": "consistent with the raw data",
    "issues": [],
    "attempts": 1
   }
  },
  "LIDC-IDRI-0265": {
   "view": "PA",
   "viewEvidence": "SID 1.80 m",
   "viewNote": "",
   "scores": [
    {
     "label": "Infiltration",
     "score": 0.0934
    },
    {
     "label": "Atelectasis",
     "score": 0.0644
    },
    {
     "label": "Lung Opacity",
     "score": 0.0264
    },
    {
     "label": "Consolidation",
     "score": 0.0095
    },
    {
     "label": "Nodule",
     "score": 0.0089
    },
    {
     "label": "Fracture",
     "score": 0.0088
    },
    {
     "label": "Effusion",
     "score": 0.005
    },
    {
     "label": "Fibrosis",
     "score": 0.0042
    },
    {
     "label": "Enlarged Cardiomediastinum",
     "score": 0.003
    },
    {
     "label": "Pleural_Thickening",
     "score": 0.003
    },
    {
     "label": "Mass",
     "score": 0.0029
    },
    {
     "label": "Pneumonia",
     "score": 0.0023
    },
    {
     "label": "Cardiomegaly",
     "score": 0.0018
    },
    {
     "label": "Hernia",
     "score": 0.0012
    },
    {
     "label": "Pneumothorax",
     "score": 0.0007
    },
    {
     "label": "Lung Lesion",
     "score": 0.0005
    },
    {
     "label": "Edema",
     "score": 0.0003
    },
    {
     "label": "Emphysema",
     "score": 0.0002
    }
   ],
   "nodule": 0.0089,
   "mass": 0.0029,
   "image": "data/lidc/LIDC-IDRI-0265/cxr.jpg",
   "summary": {
    "en": "This research prototype summary for anonymised patient LIDC-IDRI-0265 evaluates a PA view chest X-ray (SID 1.80 m) using TorchXRayVision DenseNet121 1.5.7. The classifier scores are uncalibrated model outputs from 0 to 1, not probabilities or a diagnosis, and no decision threshold is applied. The model produced a Nodule score of 0.01 and a Mass score of 0.00, whereas the reference CT identified 1 radiologist-marked nodule measuring 35.0 mm (Lung-RADS 4X-like). Note that this classifier is not a nodule detector, and because scan dates for both de-identified images are unknown, a nodule present on CT may not have been visible on the X-ray.",
    "fi": "Tämä tutkimusprototyypin tiivistelmä anonymisoidulle potilaalle LIDC-IDRI-0265 arvioi PA-suunnan keuhkoröntgenkuvaa (SID 1,80 m) käyttäen TorchXRayVision DenseNet121 1.5.7 -luokittelijaa. Mallin antamat pisteet ovat kalibroimattomia ulostuloja välillä 0–1, eivät todennäköisyyksiä tai diagnoosi, eikä päätöskynnystä käytetä. Malli antoi Nodule-pisteiksi 0,01 ja Mass-pisteiksi 0,00, kun taas viite-tietokonetomografiassa havaittiin 1 radiologin merkitsemä 35,0 mm kokoinen pesäke (Lung-RADS 4X -tyyppinen). Luokittelija ei ole pesäketetektori, ja koska molempien anonymisoitujen kuvien ajankohdat ovat tuntemattomat, TT-kuvassa näkyvä pesäke ei välttämättä ollut näkyvissä röntgenkuvassa."
   },
   "keyPoints": {
    "en": [
     "Research prototype output for patient LIDC-IDRI-0265 (PA view); scores are uncalibrated model outputs from 0 to 1, not probabilities or a diagnosis.",
     "Classifier scores for Nodule (0.01) and Mass (0.00) were low.",
     "CT reference showed 1 marked nodule of 35.0 mm (Lung-RADS 4X-like), but the classifier is not a nodule detector and acquisition dates are unknown."
    ],
    "fi": [
     "Tutkimusprototyypin tulos potilaalle LIDC-IDRI-0265 (PA-näkymä); pisteet ovat kalibroimattomia mallin ulostuloja välillä 0–1, eivät todennäköisyyksiä tai diagnoosi.",
     "Luokittelijan pisteet luokille Nodule (0,01) ja Mass (0,00) olivat matalat.",
     "Viite-TT-kuvassa näkyi 1 merkitty 35,0 mm pesäke (Lung-RADS 4X -tyyppinen), mutta luokittelija ei ole pesäketetektori ja kuvausajankohdat ovat tuntemattomat."
    ]
   },
   "review": {
    "verdict": "consistent with the raw data",
    "issues": [],
    "attempts": 1
   }
  }
 }
};
